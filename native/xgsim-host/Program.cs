using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace XgSimHost
{
    internal static class Program
    {
        private const int ProtocolVersion = 1;
        private const int MaxRequestCharacters = 1_000_000;
        private const int MaxBindings = 256;
        private const int BoolChannelType = 1;
        private const int WatchdogTimeoutMilliseconds = 5000;

        private static readonly Regex NoncePattern = new Regex("^[a-f0-9]{32,128}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex InputPattern = new Regex("^B\\d+S\\d+\\.IN\\d+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex OutputPattern = new Regex("^B\\d+S\\d+\\.OUT\\d+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex Sha256Pattern = new Regex("^[a-f0-9]{64}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxRequestCharacters, RecursionLimit = 32 };

        private static dynamic _device;
        private static dynamic _channel;
        private static string _nonce;
        private static bool _connected;
        private static int _baseNumber;
        private static int _slotNumber;
        private static HashSet<string> _allowedInputs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static HashSet<string> _allowedOutputs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static DateTime _lastAuthenticatedRequestUtc = DateTime.UtcNow;
        private static string _declaredCpuModel;
        private static string _declaredProjectId;
        private static string _declaredProjectSha256;

        [STAThread]
        private static int Main()
        {
            Console.InputEncoding = System.Text.Encoding.UTF8;
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            Console.Out.Flush();

            Task<string> pendingRead = Console.In.ReadLineAsync();
            while (true)
            {
                if (!pendingRead.Wait(250))
                {
                    if (_connected && (DateTime.UtcNow - _lastAuthenticatedRequestUtc).TotalMilliseconds >= WatchdogTimeoutMilliseconds)
                        SafeDisconnect();
                    continue;
                }
                var line = pendingRead.Result;
                if (line == null) break;
                pendingRead = Console.In.ReadLineAsync();
                if (line.Length > MaxRequestCharacters)
                {
                    WriteError(null, null, "REQUEST_TOO_LARGE", "Host request exceeded the maximum size.", true);
                    continue;
                }

                Dictionary<string, object> request = null;
                string requestId = null;
                string nonce = null;
                try
                {
                    request = AsObject(Json.DeserializeObject(line), "request");
                    requestId = RequiredString(request, "requestId");
                    nonce = RequiredString(request, "nonce");
                    var version = RequiredInt(request, "protocolVersion");
                    var command = RequiredString(request, "command");
                    var payload = AsObject(Required(request, "payload"), "payload");

                    if (version != ProtocolVersion) throw new HostException("PROTOCOL_VERSION_MISMATCH", "Unsupported protocol version.", true);
                    Guid parsedId;
                    if (!Guid.TryParse(requestId, out parsedId)) throw new HostException("INVALID_REQUEST_ID", "Request id must be a UUID.", true);
                    if (!NoncePattern.IsMatch(nonce)) throw new HostException("INVALID_NONCE", "Session nonce must contain 32-128 hexadecimal characters.", true);

                    object result;
                    if (command == "hello")
                    {
                        if (_nonce != null && !String.Equals(_nonce, nonce, StringComparison.Ordinal))
                            throw new HostException("NONCE_MISMATCH", "Host session nonce already belongs to another client.", true);
                        _nonce = nonce;
                        result = Capabilities();
                    }
                    else
                    {
                        RequireNonce(nonce);
                        _lastAuthenticatedRequestUtc = DateTime.UtcNow;
                        result = Dispatch(command, payload);
                    }
                    WriteSuccess(requestId, nonce, result);
                    if (command == "shutdown") break;
                }
                catch (HostException ex)
                {
                    WriteError(requestId, nonce, ex.Code, ex.Message, ex.Blocked);
                }
                catch (COMException ex)
                {
                    SafeDisconnect();
                    WriteError(requestId, nonce, "COM_ERROR", Sanitize(ex.Message), true);
                }
                catch (Exception ex)
                {
                    WriteError(requestId, nonce, "HOST_ERROR", Sanitize(ex.Message), false);
                }
            }

            SafeDisconnect();
            return 0;
        }

        private static object Dispatch(string command, Dictionary<string, object> payload)
        {
            switch (command)
            {
                case "probe": return Probe(payload);
                case "connect": return Connect(payload);
                case "readSnapshot": return ReadSnapshot();
                case "writeInputImage": return WriteInputImage(payload);
                case "getStatus": return Status();
                case "disconnect": SafeDisconnect(); return Status();
                case "shutdown": SafeDisconnect(); return Status();
                default: throw new HostException("UNKNOWN_COMMAND", "Unknown host command.", true);
            }
        }

        private static object Probe(Dictionary<string, object> payload)
        {
            var baseNumber = Range(RequiredInt(payload, "base"), "base", 0, 255);
            var slotNumber = Range(RequiredInt(payload, "slot"), "slot", 0, 255);
            EnsureComObjects();
            var code = Convert.ToInt32(_device.Connect(), CultureInfo.InvariantCulture);
            var count = Convert.ToInt32(_channel.GetChannelCount(baseNumber, slotNumber), CultureInfo.InvariantCulture);
            var channels = new List<string>();
            for (var index = 0; index < count; index++)
                channels.Add(Convert.ToString(_channel.GetChannelNameAt(baseNumber, slotNumber, index), CultureInfo.InvariantCulture));
            return new Dictionary<string, object>
            {
                { "available", code == 0 || code == 3 }, { "connectCode", code },
                { "base", baseNumber }, { "slot", slotNumber }, { "channels", channels }, { "capabilities", Capabilities() },
            };
        }

        private static object Connect(Dictionary<string, object> payload)
        {
            _baseNumber = Range(RequiredInt(payload, "base"), "base", 0, 255);
            _slotNumber = Range(RequiredInt(payload, "slot"), "slot", 0, 255);
            _declaredCpuModel = RequiredString(payload, "cpuModel");
            _declaredProjectId = RequiredString(payload, "projectId");
            _declaredProjectSha256 = RequiredString(payload, "projectSha256");
            if (!Sha256Pattern.IsMatch(_declaredProjectSha256)) throw new HostException("INVALID_PROJECT_HASH", "Project SHA-256 must contain exactly 64 hexadecimal characters.", true);
            var inputs = RequiredStringArray(payload, "allowedInputs", MaxBindings);
            var outputs = RequiredStringArray(payload, "allowedOutputs", MaxBindings);
            if (inputs.Any(value => !InputPattern.IsMatch(value))) throw new HostException("INVALID_INPUT_ALLOWLIST", "Only documented IN channels may be writable.", true);
            if (outputs.Any(value => !OutputPattern.IsMatch(value))) throw new HostException("INVALID_OUTPUT_ALLOWLIST", "Only documented OUT channels may be readable.", true);
            _allowedInputs = new HashSet<string>(inputs, StringComparer.OrdinalIgnoreCase);
            _allowedOutputs = new HashSet<string>(outputs, StringComparer.OrdinalIgnoreCase);

            EnsureComObjects();
            var code = Convert.ToInt32(_device.Connect(), CultureInfo.InvariantCulture);
            if (code != 0 && code != 3) throw new HostException("DEVICE_SERVER_NOT_READY", "XG-SIM device server is not ready. Connect code: " + code, true);
            _connected = true;
            _lastAuthenticatedRequestUtc = DateTime.UtcNow;
            return new Dictionary<string, object>
            {
                { "connected", true }, { "connectCode", code }, { "base", _baseNumber }, { "slot", _slotNumber },
                { "inputCount", _allowedInputs.Count }, { "outputCount", _allowedOutputs.Count },
                { "declaredCpuModel", _declaredCpuModel }, { "declaredProjectId", _declaredProjectId },
                { "declaredProjectSha256", _declaredProjectSha256 }, { "projectIdentityVerified", false },
            };
        }

        private static object ReadSnapshot()
        {
            RequireConnected();
            var inputs = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            var outputs = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var address in _allowedInputs.OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
                inputs[address] = ReadBool(address);
            foreach (var address in _allowedOutputs.OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
                outputs[address] = ReadBool(address);
            return new Dictionary<string, object>
            {
                { "capturedAt", DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture) },
                { "inputs", inputs }, { "outputs", outputs },
            };
        }

        private static object WriteInputImage(Dictionary<string, object> payload)
        {
            RequireConnected();
            var values = AsObject(Required(payload, "values"), "values");
            if (values.Count > MaxBindings) throw new HostException("INPUT_FRAME_TOO_LARGE", "Input frame exceeded the binding limit.", true);
            var accepted = new List<string>();
            try
            {
                foreach (var entry in values.OrderBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase))
                {
                    if (!InputPattern.IsMatch(entry.Key) || !_allowedInputs.Contains(entry.Key))
                        throw new HostException("INPUT_NOT_ALLOWED", "Input address is not in the session allowlist: " + entry.Key, true);
                    if (!(entry.Value is bool)) throw new HostException("INPUT_TYPE_MISMATCH", "Only BOOL input frames are supported in the first host version.", true);
                    _channel.WriteIOChannel(entry.Key, BoolChannelType, (bool)entry.Value);
                    accepted.Add(entry.Key);
                }
            }
            catch
            {
                SafeDisconnect();
                throw;
            }
            return new Dictionary<string, object> { { "accepted", accepted } };
        }

        private static bool ReadBool(string address)
        {
            object value;
            _channel.ReadIOChannel(address, BoolChannelType, out value);
            return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
        }

        private static object Status()
        {
            return new Dictionary<string, object>
            {
                { "state", _connected ? "connected" : "disconnected" },
                { "executionState", "unknown" },
                { "base", _baseNumber }, { "slot", _slotNumber },
                { "inputCount", _allowedInputs.Count }, { "outputCount", _allowedOutputs.Count },
                { "projectIdentityVerified", false },
            };
        }

        private static object Capabilities()
        {
            return new Dictionary<string, object>
            {
                { "provider", "xgsim" }, { "protocolVersion", ProtocolVersion },
                { "supportsInputChannels", true }, { "supportsOutputChannels", true },
                { "supportsDeviceRead", false }, { "supportsOutputWrite", false },
                { "maximumBindings", MaxBindings }, { "transport", "stdio" }, { "processArchitecture", "x86" },
                { "supportsProjectIdentityVerification", false }, { "watchdogTimeoutMs", WatchdogTimeoutMilliseconds },
            };
        }

        private static void EnsureComObjects()
        {
            if (_device != null && _channel != null) return;
            var deviceType = Type.GetTypeFromProgID("XimUtil.DeviceInterface", false);
            var channelType = Type.GetTypeFromProgID("XimUtil.ChannelDriver", false);
            if (deviceType == null || channelType == null)
                throw new HostException("XGSIM_NOT_INSTALLED", "Registered XimUtil COM classes were not found.", true);
            _device = Activator.CreateInstance(deviceType);
            _channel = Activator.CreateInstance(channelType);
        }

        private static void RequireConnected()
        {
            if (!_connected) throw new HostException("NOT_CONNECTED", "The host is not connected to XG-SIM.", true);
        }

        private static void RequireNonce(string nonce)
        {
            if (_nonce == null) throw new HostException("HELLO_REQUIRED", "A hello request must establish the session nonce first.", true);
            if (!String.Equals(_nonce, nonce, StringComparison.Ordinal)) throw new HostException("NONCE_MISMATCH", "Session nonce mismatch.", true);
        }

        private static void SafeDisconnect()
        {
            if (_channel != null)
            {
                foreach (var address in _allowedInputs)
                {
                    try { _channel.WriteIOChannel(address, BoolChannelType, false); } catch { }
                }
            }
            ReleaseCom(_channel);
            ReleaseCom(_device);
            _channel = null;
            _device = null;
            _connected = false;
            _allowedInputs.Clear();
            _allowedOutputs.Clear();
            _declaredCpuModel = null;
            _declaredProjectId = null;
            _declaredProjectSha256 = null;
        }

        private static void ReleaseCom(object value)
        {
            if (value != null && Marshal.IsComObject(value))
            {
                try { Marshal.FinalReleaseComObject(value); } catch { }
            }
        }

        private static Dictionary<string, object> AsObject(object value, string name)
        {
            var result = value as Dictionary<string, object>;
            if (result == null) throw new HostException("INVALID_REQUEST", name + " must be a JSON object.", true);
            return result;
        }

        private static object Required(Dictionary<string, object> source, string key)
        {
            object value;
            if (!source.TryGetValue(key, out value)) throw new HostException("INVALID_REQUEST", "Missing field: " + key, true);
            return value;
        }

        private static string RequiredString(Dictionary<string, object> source, string key)
        {
            var value = Required(source, key) as string;
            if (String.IsNullOrWhiteSpace(value)) throw new HostException("INVALID_REQUEST", key + " must be a non-empty string.", true);
            return value;
        }

        private static int RequiredInt(Dictionary<string, object> source, string key)
        {
            return Convert.ToInt32(Required(source, key), CultureInfo.InvariantCulture);
        }

        private static int Range(int value, string name, int minimum, int maximum)
        {
            if (value < minimum || value > maximum) throw new HostException("INVALID_REQUEST", name + " is out of range.", true);
            return value;
        }

        private static string[] RequiredStringArray(Dictionary<string, object> source, string key, int maximum)
        {
            var array = Required(source, key) as object[];
            if (array == null) throw new HostException("INVALID_REQUEST", key + " must be an array.", true);
            if (array.Length > maximum) throw new HostException("BINDING_LIMIT_EXCEEDED", key + " exceeds the binding limit.", true);
            var values = array.Select(value => value as string).ToArray();
            if (values.Any(String.IsNullOrWhiteSpace)) throw new HostException("INVALID_REQUEST", key + " contains an invalid address.", true);
            if (values.Distinct(StringComparer.OrdinalIgnoreCase).Count() != values.Length)
                throw new HostException("DUPLICATE_ADDRESS", key + " contains duplicate addresses.", true);
            return values;
        }

        private static void WriteSuccess(string requestId, string nonce, object result)
        {
            Write(new Dictionary<string, object>
            {
                { "protocolVersion", ProtocolVersion }, { "requestId", requestId }, { "nonce", nonce },
                { "ok", true }, { "result", result },
            });
        }

        private static void WriteError(string requestId, string nonce, string code, string message, bool blocked)
        {
            Write(new Dictionary<string, object>
            {
                { "protocolVersion", ProtocolVersion }, { "requestId", requestId ?? Guid.Empty.ToString() },
                { "nonce", NoncePattern.IsMatch(nonce ?? String.Empty) ? nonce : new string('0', 32) }, { "ok", false },
                { "error", new Dictionary<string, object> { { "code", code }, { "message", Sanitize(message) }, { "blocked", blocked } } },
            });
        }

        private static void Write(object payload)
        {
            Console.WriteLine(Json.Serialize(payload));
            Console.Out.Flush();
        }

        private static string Sanitize(string value)
        {
            return (value ?? String.Empty).Replace('\r', ' ').Replace('\n', ' ');
        }

        private sealed class HostException : Exception
        {
            public string Code { get; private set; }
            public bool Blocked { get; private set; }
            public HostException(string code, string message, bool blocked) : base(message) { Code = code; Blocked = blocked; }
        }
    }
}
