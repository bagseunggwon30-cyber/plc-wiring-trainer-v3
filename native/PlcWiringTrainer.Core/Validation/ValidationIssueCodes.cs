namespace PlcWiringTrainer.Core.Validation;

/// <summary>검증 코드의 철자와 회귀 allowlist를 한 곳에서 고정합니다.</summary>
internal static class ValidationIssueCodes
{
    public const string AC_LINE_NEUTRAL_SHORT = nameof(AC_LINE_NEUTRAL_SHORT);

    public const string AC_LINE_TO_PE = nameof(AC_LINE_TO_PE);

    public const string AC_PHASE_SHORT = nameof(AC_PHASE_SHORT);

    public const string AC_LOAD_WIRING = nameof(AC_LOAD_WIRING);

    public const string ANALOG_SCALING_INCOMPLETE = nameof(ANALOG_SCALING_INCOMPLETE);

    public const string CABLE_MEMBERSHIP_MISMATCH = nameof(CABLE_MEMBERSHIP_MISMATCH);

    public const string CURRENT_LOOP_POLARITY = nameof(CURRENT_LOOP_POLARITY);

    public const string DC_SHORT_CIRCUIT = nameof(DC_SHORT_CIRCUIT);

    public const string DEVICE_OUTSIDE_PANEL = nameof(DEVICE_OUTSIDE_PANEL);

    public const string DUPLICATE_CABLE_CORE = nameof(DUPLICATE_CABLE_CORE);

    public const string DUPLICATE_CONNECTION = nameof(DUPLICATE_CONNECTION);

    public const string DUPLICATE_DOCUMENT_ID = nameof(DUPLICATE_DOCUMENT_ID);

    public const string DUPLICATE_WIRE_NUMBER = nameof(DUPLICATE_WIRE_NUMBER);

    public const string EDUCATIONAL_PROFILE = nameof(EDUCATIONAL_PROFILE);

    public const string INVALID_CONDUCTOR_GAUGE = nameof(INVALID_CONDUCTOR_GAUGE);

    public const string INVALID_INTERNAL_LINK = nameof(INVALID_INTERNAL_LINK);

    public const string INVALID_TERMINAL_BRIDGE = nameof(INVALID_TERMINAL_BRIDGE);

    public const string LAMP_OPEN_OR_REVERSED = nameof(LAMP_OPEN_OR_REVERSED);

    public const string MANUAL_EVIDENCE_REQUIRED = nameof(MANUAL_EVIDENCE_REQUIRED);

    public const string NPN_INPUT_COMMON_POLARITY = nameof(NPN_INPUT_COMMON_POLARITY);

    public const string PHYSICAL_SCALE_REQUIRED = nameof(PHYSICAL_SCALE_REQUIRED);

    public const string PNP_INPUT_COMMON_POLARITY = nameof(PNP_INPUT_COMMON_POLARITY);

    public const string PROFILE_NOT_FOUND = nameof(PROFILE_NOT_FOUND);

    public const string PROFILE_VERSION_MISMATCH = nameof(PROFILE_VERSION_MISMATCH);

    public const string SENSOR_OUTPUT_NOT_CONNECTED = nameof(SENSOR_OUTPUT_NOT_CONNECTED);

    public const string SENSOR_SUPPLY_POSITIVE = nameof(SENSOR_SUPPLY_POSITIVE);

    public const string SENSOR_SUPPLY_RETURN = nameof(SENSOR_SUPPLY_RETURN);

    public const string SHIELD_DRAIN_REQUIRED = nameof(SHIELD_DRAIN_REQUIRED);

    public const string SOURCE_SYSTEM_INCOMPLETE = nameof(SOURCE_SYSTEM_INCOMPLETE);

    public const string TERMINAL_CAPACITY_EXCEEDED = nameof(TERMINAL_CAPACITY_EXCEEDED);

    public const string UNKNOWN_CABLE_ASSEMBLY = nameof(UNKNOWN_CABLE_ASSEMBLY);

    public const string UNKNOWN_CABLE_CONDUCTOR = nameof(UNKNOWN_CABLE_CONDUCTOR);

    public const string UNKNOWN_DRAIN_CONDUCTOR = nameof(UNKNOWN_DRAIN_CONDUCTOR);

    public const string UNKNOWN_TERMINAL = nameof(UNKNOWN_TERMINAL);

    public const string WIRE_NUMBER_REQUIRED = nameof(WIRE_NUMBER_REQUIRED);

    public static IReadOnlyList<string> All { get; } =
    [
        AC_LINE_NEUTRAL_SHORT,
        AC_LINE_TO_PE,
        AC_PHASE_SHORT,
        AC_LOAD_WIRING,
        ANALOG_SCALING_INCOMPLETE,
        CABLE_MEMBERSHIP_MISMATCH,
        CURRENT_LOOP_POLARITY,
        DC_SHORT_CIRCUIT,
        DEVICE_OUTSIDE_PANEL,
        DUPLICATE_CABLE_CORE,
        DUPLICATE_CONNECTION,
        DUPLICATE_DOCUMENT_ID,
        DUPLICATE_WIRE_NUMBER,
        EDUCATIONAL_PROFILE,
        INVALID_CONDUCTOR_GAUGE,
        INVALID_INTERNAL_LINK,
        INVALID_TERMINAL_BRIDGE,
        LAMP_OPEN_OR_REVERSED,
        MANUAL_EVIDENCE_REQUIRED,
        NPN_INPUT_COMMON_POLARITY,
        PHYSICAL_SCALE_REQUIRED,
        PNP_INPUT_COMMON_POLARITY,
        PROFILE_NOT_FOUND,
        PROFILE_VERSION_MISMATCH,
        SENSOR_OUTPUT_NOT_CONNECTED,
        SENSOR_SUPPLY_POSITIVE,
        SENSOR_SUPPLY_RETURN,
        SHIELD_DRAIN_REQUIRED,
        SOURCE_SYSTEM_INCOMPLETE,
        TERMINAL_CAPACITY_EXCEEDED,
        UNKNOWN_CABLE_ASSEMBLY,
        UNKNOWN_CABLE_CONDUCTOR,
        UNKNOWN_DRAIN_CONDUCTOR,
        UNKNOWN_TERMINAL,
        WIRE_NUMBER_REQUIRED,
    ];
}
