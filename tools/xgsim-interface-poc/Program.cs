using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;

namespace XgSimInterfacePoc
{
    internal enum DeviceInterfaceError
    {
        None = 0,
        ServerNotReady = 1,
        RpcError = 2,
        AlreadyConnected = 3,
        UnknownDevice = 4,
        AddressError = 5
    }

    internal enum ChannelType
    {
        None = 0,
        Bool = 1,
        Sint = 2,
        Int = 3,
        Dint = 4,
        Lint = 5,
        Usint = 6,
        Uint = 7,
        Udint = 8,
        Ulint = 9,
        Float = 10,
        Double = 11
    }

    internal static class Program
    {
        private static readonly Regex InputChannelPattern =
            new Regex(@"^B\d+S\d+\.IN\d+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        private static readonly Regex OutputChannelPattern =
            new Regex(@"^B\d+S\d+\.OUT\d+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0)
                {
                    PrintUsage();
                    return 64;
                }

                switch (args[0].ToLowerInvariant())
                {
                    case "probe":
                        return Probe(args);
                    case "list-channels":
                        return ListChannels(args);
                    case "read-channel-bool":
                        return ReadChannelBool(args);
                    case "write-input-bool":
                        return WriteInputBool(args);
                    case "roundtrip-bool":
                        return RoundTripBool(args);
                    case "read-device":
                        return ReadDevice(args);
                    default:
                        Console.Error.WriteLine("Unknown command: " + args[0]);
                        PrintUsage();
                        return 64;
                }
            }
            catch (COMException ex)
            {
                Console.Error.WriteLine(
                    "COM_ERROR hresult=0x{0:X8} message={1}",
                    ex.HResult,
                    Sanitize(ex.Message));
                return 70;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("ERROR type={0} message={1}", ex.GetType().Name, Sanitize(ex.Message));
                return 70;
            }
        }

        private static int Probe(string[] args)
        {
            RequireArgCount(args, 3, "probe <base> <slot>");
            var baseNumber = ParseNonNegativeInt(args[1], "base");
            var slotNumber = ParseNonNegativeInt(args[2], "slot");

            var device = new XIMUTILLib.DeviceInterface();
            var channel = new XIMUTILLib.ChannelDriver();
            var connectCode = (DeviceInterfaceError)device.Connect();
            var channelCount = channel.GetChannelCount(baseNumber, slotNumber);

            Console.WriteLine(
                "PROBE connect={0} connectCode={1} base={2} slot={3} channelCount={4}",
                IsConnected(connectCode) ? "ok" : "failed",
                (int)connectCode,
                baseNumber,
                slotNumber,
                channelCount);

            return IsConnected(connectCode) ? 0 : 69;
        }

        private static int ListChannels(string[] args)
        {
            RequireArgCount(args, 3, "list-channels <base> <slot>");
            var baseNumber = ParseNonNegativeInt(args[1], "base");
            var slotNumber = ParseNonNegativeInt(args[2], "slot");
            var channel = new XIMUTILLib.ChannelDriver();
            var count = channel.GetChannelCount(baseNumber, slotNumber);

            Console.WriteLine("CHANNELS base={0} slot={1} count={2}", baseNumber, slotNumber, count);
            for (var i = 0; i < count; i++)
            {
                Console.WriteLine("CHANNEL index={0} name={1}", i, channel.GetChannelNameAt(baseNumber, slotNumber, i));
            }

            return 0;
        }

        private static int ReadChannelBool(string[] args)
        {
            RequireArgCount(args, 2, "read-channel-bool <channel>");
            var channel = new XIMUTILLib.ChannelDriver();
            var value = ReadBool(channel, args[1]);
            Console.WriteLine("CHANNEL_BOOL name={0} value={1}", args[1], value ? "true" : "false");
            return 0;
        }

        private static int WriteInputBool(string[] args)
        {
            RequireArgCount(args, 3, "write-input-bool <input-channel> <true|false>");
            EnsureInputChannel(args[1]);
            var value = ParseBool(args[2]);
            var channel = new XIMUTILLib.ChannelDriver();
            channel.WriteIOChannel(args[1], (int)ChannelType.Bool, value);
            Console.WriteLine("INPUT_BOOL_WRITTEN name={0} value={1}", args[1], value ? "true" : "false");
            return 0;
        }

        private static int RoundTripBool(string[] args)
        {
            if (args.Length < 3 || args.Length > 4)
            {
                throw new ArgumentException("Usage: roundtrip-bool <input-channel> <output-channel> [timeout-ms]");
            }

            EnsureInputChannel(args[1]);
            EnsureOutputChannel(args[2]);
            var timeoutMs = args.Length == 4 ? ParsePositiveInt(args[3], "timeout-ms") : 3000;
            var channel = new XIMUTILLib.ChannelDriver();
            var observations = new List<string>();

            try
            {
                channel.WriteIOChannel(args[1], (int)ChannelType.Bool, false);
                var baseline = WaitForBool(channel, args[2], false, timeoutMs, observations);
                channel.WriteIOChannel(args[1], (int)ChannelType.Bool, true);
                var rising = WaitForBool(channel, args[2], true, timeoutMs, observations);
                channel.WriteIOChannel(args[1], (int)ChannelType.Bool, false);
                var falling = WaitForBool(channel, args[2], false, timeoutMs, observations);

                Console.WriteLine(
                    "ROUNDTRIP input={0} output={1} baseline={2} rising={3} falling={4} observations={5}",
                    args[1],
                    args[2],
                    baseline ? "pass" : "fail",
                    rising ? "pass" : "fail",
                    falling ? "pass" : "fail",
                    string.Join(",", observations.ToArray()));

                return baseline && rising && falling ? 0 : 65;
            }
            finally
            {
                channel.WriteIOChannel(args[1], (int)ChannelType.Bool, false);
            }
        }

        private static int ReadDevice(string[] args)
        {
            RequireArgCount(args, 4, "read-device <device> <byte-offset> <byte-count>");
            var deviceName = args[1].ToUpperInvariant();
            if (!Regex.IsMatch(deviceName, "^[A-Z]{1,2}$", RegexOptions.CultureInvariant))
            {
                throw new ArgumentException("Device name must contain one or two ASCII letters.");
            }

            var offset = ParseNonNegativeInt(args[2], "byte-offset");
            var size = ParsePositiveInt(args[3], "byte-count");
            if (size > 256)
            {
                throw new ArgumentOutOfRangeException("byte-count", "At most 256 bytes may be read by the PoC.");
            }

            var device = new XIMUTILLib.DeviceInterface();
            var connectCode = (DeviceInterfaceError)device.Connect();
            if (!IsConnected(connectCode))
            {
                Console.Error.WriteLine("CONNECT_FAILED code={0}", (int)connectCode);
                return 69;
            }

            var buffer = new byte[size];
            var readCode = (DeviceInterfaceError)device.ReadDevice(deviceName, offset, size, ref buffer[0]);
            Console.WriteLine(
                "DEVICE_READ device={0} offset={1} size={2} code={3} hex={4}",
                deviceName,
                offset,
                size,
                (int)readCode,
                BitConverter.ToString(buffer).Replace("-", string.Empty));
            return readCode == DeviceInterfaceError.None ? 0 : 65;
        }

        private static bool WaitForBool(
            XIMUTILLib.ChannelDriver channel,
            string channelName,
            bool expected,
            int timeoutMs,
            IList<string> observations)
        {
            var started = Environment.TickCount;
            do
            {
                var actual = ReadBool(channel, channelName);
                observations.Add((Environment.TickCount - started).ToString(CultureInfo.InvariantCulture) + ":" + (actual ? "1" : "0"));
                if (actual == expected)
                {
                    return true;
                }

                Thread.Sleep(20);
            }
            while (unchecked(Environment.TickCount - started) < timeoutMs);

            return false;
        }

        private static bool ReadBool(XIMUTILLib.ChannelDriver channel, string channelName)
        {
            object value;
            channel.ReadIOChannel(channelName, (int)ChannelType.Bool, out value);
            return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
        }

        private static void EnsureInputChannel(string channelName)
        {
            if (!InputChannelPattern.IsMatch(channelName))
            {
                throw new ArgumentException("Only documented input channel names such as B0S00.IN00 may be written.");
            }
        }

        private static void EnsureOutputChannel(string channelName)
        {
            if (!OutputChannelPattern.IsMatch(channelName))
            {
                throw new ArgumentException("Output must be a read-only channel name such as B0S01.OUT00.");
            }
        }

        private static bool IsConnected(DeviceInterfaceError code)
        {
            return code == DeviceInterfaceError.None || code == DeviceInterfaceError.AlreadyConnected;
        }

        private static bool ParseBool(string value)
        {
            bool result;
            if (!bool.TryParse(value, out result))
            {
                throw new ArgumentException("Expected true or false, got: " + value);
            }

            return result;
        }

        private static int ParseNonNegativeInt(string value, string name)
        {
            int result;
            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out result) || result < 0)
            {
                throw new ArgumentException(name + " must be a non-negative integer.");
            }

            return result;
        }

        private static int ParsePositiveInt(string value, string name)
        {
            var result = ParseNonNegativeInt(value, name);
            if (result == 0)
            {
                throw new ArgumentException(name + " must be greater than zero.");
            }

            return result;
        }

        private static void RequireArgCount(string[] args, int count, string usage)
        {
            if (args.Length != count)
            {
                throw new ArgumentException("Usage: " + usage);
            }
        }

        private static string Sanitize(string value)
        {
            return (value ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ');
        }

        private static void PrintUsage()
        {
            Console.Error.WriteLine("Commands:");
            Console.Error.WriteLine("  probe <base> <slot>");
            Console.Error.WriteLine("  list-channels <base> <slot>");
            Console.Error.WriteLine("  read-channel-bool <channel>");
            Console.Error.WriteLine("  write-input-bool <input-channel> <true|false>");
            Console.Error.WriteLine("  roundtrip-bool <input-channel> <output-channel> [timeout-ms]");
            Console.Error.WriteLine("  read-device <device> <byte-offset> <byte-count>");
        }
    }
}
