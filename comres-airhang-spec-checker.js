/* =========================================================================
   COMRES AIRHANG SPEC CHECKER
   -------------------------------------------------------------------------
   What this does
   ---------------
   Run this against an ADR Airhang report (the .htm file Quasar/CWI
   generates) that is already open as the active tab in Edge. It scans
   every parameter table in the report (Compensated Drive Levels, Phase,
   Atten, Amplitude... under High Gain / Low Gain x 500 kHz / 2 MHz), looks
   up each value against the SPEC table below, and highlights every cell:

       green  = PASS
       orange = WARNING (outside pass range, still inside warning range)
       red    = FAIL (outside both pass and warning range)
       gray   = value is "na" / blank (skipped)
       yellow = no spec entry defined for that parameter yet

   It also computes one derived check that doesn't exist as a single cell
   in the report: Upper Atten minus Lower Atten, evaluated with the same
   pass/warning/fail logic, added as an extra row under the Atten table.

   It also drops a floating panel (top-right) with a pass/warning/fail
   summary, a "jump to next issue" button, and a spec editor so you can
   add/adjust limits live without re-editing this file every time, then
   export the result back out as JSON to paste in here permanently.

   How to use it
   --------------
   1. Open the ADR Airhang .htm report in Edge.
   2. Fill in SPEC below with real limits (see the shapes explained below).
      You can leave parameters out — they'll just show up yellow
      ("no spec") until you add them.
   3. Turn this file into a bookmarklet (see the install page / DEPLOY.md
      in the same folder) and click the bookmarklet while the report tab
      is active. Or: paste this whole file into DevTools Console
      (F12 > Console) on the report tab and hit Enter — works exactly the
      same, no bookmarklet needed.
   4. Re-run any time (e.g. after editing SPEC in the live panel) by
      clicking the bookmarklet again, or the panel's Rescan button — it
      re-scans from scratch.

   Editing SPEC — two-tier (pass/fail only, no warning band)
   -----------------------------------------------------------
     { min: 4800, max: 6000 }                  -> hard range
     { expected: 5450, tol: 200 }              -> center +/- absolute tol
     { expected: 5450, tolPct: 5 }             -> center +/- % tol
     { max: 0.05 }                             -> ceiling only (e.g. std dev)
     { min: 20 }                               -> floor only
   Anything outside this range is FAIL. There is no WARNING tier unless you
   use the three-tier shape below.

   Editing SPEC — three-tier (pass / warning / fail)
   ----------------------------------------------------
     {
       pass: { min: -0.5, max: 0.5 },          // or { expected, tol/tolPct }
       warn: { min: -1.0, max: 1.0 }           // or { expected, tol/tolPct }
     }
   Evaluated in order: inside `pass` range -> PASS (green). Not in `pass`
   but inside `warn` range -> WARNING (orange). Outside both -> FAIL (red).
   The `warn` range should be the wider one (it's checked as a fallback,
   not intersected with `pass`).

   Keys, from outer to inner:
     SPEC[section][parameterName][spacing]
     SPEC[section][parameterName]["*"]          -> applies to all spacings
                                                    under that parameter
     SPEC["*"][parameterName][...]              -> applies to that
                                                    parameter name in ANY
                                                    section (checked only if
                                                    the section-specific
                                                    lookup found nothing)

   section is one of exactly these four strings (matches the report's own
   section headers):
     "High Gain 500 kHz", "High Gain 2 MHz",
     "Low Gain 500 kHz",  "Low Gain 2 MHz"

   parameterName must match the row label text in the report exactly
   (e.g. "Upper Tx Voltage (mV)", "Compensated Atten", "Compensated Phase").
   The derived Upper-Lower Atten check uses the synthetic parameter name
   "Atten Diff (Upper - Lower)" — see DERIVED_CHECKS below.

   Run once with an empty-ish SPEC and open the "Edit Spec" panel in the
   report — it lists every parameter name + spacing actually found or
   computed in THIS report, pre-formatted as a JSON skeleton you can copy
   from (including the derived Atten Diff row).
   ========================================================================= */

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // 1. SPEC TABLE — merged from two sources:
  //
  //    (a) SPC_Outlier_Dashboard-3.xlsx "Stats" sheet (LCL/UCL), used as-is
  //        for anything the engineering spec below doesn't cover (Gain,
  //        Tx Voltage, Rx Gain, Upper/Lower Atten individually, Upper/Lower
  //        Far, Amplitude, Deep Geo-Steering, Deep Resistivity, etc).
  //
  //    (b) The engineering spec sheets (500 kHz and 2 MHz tables), which
  //        take priority over (a) wherever both exist — Stats entries for
  //        Tx Current, Upper/Lower Phase, Compensated Phase (+Std Dev),
  //        Compensated Atten (+Std Dev), and (2 MHz only) Upper/Lower Near
  //        were deliberately removed from the Stats block below so lookup
  //        falls through to these section-specific / wildcard entries
  //        instead. Same values apply to High Gain and Low Gain alike
  //        (per the spec sheets) — Tx Current is the only thing that
  //        differs between 500 kHz and 2 MHz; everything else in (b) is
  //        identical across all four sections and lives under SPEC["*"].
  //
  //        NOT implemented: "Phase Difference Between Spacing ≤ 2deg" —
  //        explicitly excluded per instruction (would need a different,
  //        cross-spacing comparison mechanism this tool doesn't have yet).
  //
  //        "Compensated Atten ± 0.15 of Expected Atten" is handled by the
  //        AUTO_EXPECTED_RULES tolerance below (reads each report's own
  //        Expected Atten cell as the reference), not a fixed number here
  //        — the 11.63/6.20/4.23-style values in the spec sheets are
  //        example/nominal, not enforced directly.
  const SPEC = {
    "High Gain 500 kHz": {
      "Upper Tx Voltage (mV)": {
        "48''": {
          min: 3504.6983,
          max: 8853.0336,
        },
      },
      "Lower Tx Voltage (mV)": {
        "48''": {
          min: 3099.2684,
          max: 9234.7522,
        },
      },
      Gain: {
        "48''": {
          min: 6,
          max: 6,
        },
      },
      "Upper Atten": {
        "48''": {
          min: 2.2021,
          max: 5.914,
        },
      },
      "Lower Atten": {
        "48''": {
          min: 2.4984,
          max: 6.2355,
        },
      },
      "Expected Atten": {
        "48''": {
          min: 4.26,
          max: 4.26,
        },
      },
      "Upper Near": {
        "16''": {
          min: 0.7,
          max: 0.8,
        },
        "32''": {
          min: 0.7,
          max: 0.8,
        },
        "48''": {
          min: 0.45,
          max: 0.55,
        },
      },
      "Upper Far": {
        "48''": {
          min: 0.2464,
          max: 0.379,
        },
      },
      "Lower Near": {
        "16''": {
          min: 0.7,
          max: 0.8,
        },
        "32''": {
          min: 0.7,
          max: 0.8,
        },
        "48''": {
          min: 0.45,
          max: 0.55,
        },
      },
      "Lower Far": {
        "48''": {
          min: 0.236,
          max: 0.3677,
        },
      },
      "Upper Tx Current (mA)": {
        "16''": {
          min: 11,
          max: 41,
        },
        "32''": {
          min: 28,
          max: 58,
        },
        "48''": {
          min: 12,
          max: 42,
        },
      },
      "Lower Tx Current (mA)": {
        "16''": {
          min: 11,
          max: 41,
        },
        "32''": {
          min: 28,
          max: 58,
        },
        "48''": {
          min: 12,
          max: 42,
        },
      },
    },
    "High Gain 2 MHz": {
      "Upper Tx Voltage (mV)": {
        "32''": {
          min: 4990.2665,
          max: 12736.5376,
        },
        "48''": {
          min: 5577.9767,
          max: 13988.0027,
        },
      },
      "Lower Tx Voltage (mV)": {
        "32''": {
          min: 5172.8732,
          max: 13582.7969,
        },
        "48''": {
          min: 5902.8787,
          max: 15735.2656,
        },
      },
      Gain: {
        "32''": {
          min: 4,
          max: 4,
        },
        "48''": {
          min: 6,
          max: 6,
        },
      },
      "Upper Atten": {
        "32''": {
          min: 4.4694,
          max: 7.6972,
        },
        "48''": {
          min: 2.5102,
          max: 5.7507,
        },
      },
      "Lower Atten": {
        "32''": {
          min: 4.6441,
          max: 7.8905,
        },
        "48''": {
          min: 2.6147,
          max: 5.9137,
        },
      },
      "Expected Atten": {
        "32''": {
          min: 6.26,
          max: 6.26,
        },
        "48''": {
          min: 4.26,
          max: 4.26,
        },
      },
      "Upper Far": {
        "32''": {
          min: 0.3034,
          max: 0.4395,
        },
        "48''": {
          min: 0.3806,
          max: 0.5557,
        },
      },
      "Lower Far": {
        "32''": {
          min: 0.2936,
          max: 0.4338,
        },
        "48''": {
          min: 0.3728,
          max: 0.5494,
        },
      },
      "Upper Tx Current (mA)": {
        "16''": {
          min: -10,
          max: 30,
        },
        "32''": {
          min: 15,
          max: 55,
        },
        "48''": {
          min: 20,
          max: 60,
        },
      },
      "Lower Tx Current (mA)": {
        "16''": {
          min: -10,
          max: 30,
        },
        "32''": {
          min: 15,
          max: 55,
        },
        "48''": {
          min: 20,
          max: 60,
        },
      },
      "Upper Near": {
        "*": {
          min: 0.7,
          max: 0.8,
        },
      },
      "Lower Near": {
        "*": {
          min: 0.7,
          max: 0.8,
        },
      },
    },
    "Low Gain 500 kHz": {
      "Upper Tx Voltage (mV)": {
        "16''": {
          min: 3196.6697,
          max: 7229.1035,
        },
        "32''": {
          min: 5706.2771,
          max: 12386.5064,
        },
        "48''": {
          min: 3504.6983,
          max: 8853.0336,
        },
      },
      "Lower Tx Voltage (mV)": {
        "16''": {
          min: 2831.5466,
          max: 7431.34,
        },
        "32''": {
          min: 5041.8558,
          max: 12716.907,
        },
        "48''": {
          min: 3099.2684,
          max: 9234.7522,
        },
      },
      Gain: {
        "16''": {
          min: 0,
          max: 0,
        },
        "32''": {
          min: 3,
          max: 3,
        },
        "48''": {
          min: 5,
          max: 5,
        },
      },
      "Upper Atten": {
        "16''": {
          min: 9.7168,
          max: 13.3127,
        },
        "32''": {
          min: 4.1805,
          max: 7.8395,
        },
        "48''": {
          min: 2.2132,
          max: 5.8794,
        },
      },
      "Lower Atten": {
        "16''": {
          min: 10.0387,
          max: 13.5876,
        },
        "32''": {
          min: 4.5099,
          max: 8.1791,
        },
        "48''": {
          min: 2.5531,
          max: 6.2169,
        },
      },
      "Expected Atten": {
        "16''": {
          min: 12.38,
          max: 12.38,
        },
        "32''": {
          min: 6.26,
          max: 6.26,
        },
        "48''": {
          min: 4.26,
          max: 4.26,
        },
        "50''": {
          min: 0,
          max: 0,
        },
        "66''": {
          min: 0,
          max: 0,
        },
        "82''": {
          min: 0,
          max: 0,
        },
      },
      "Upper Near": {
        "16''": {
          min: 0.7,
          max: 0.8,
        },
        "32''": {
          min: 0.7,
          max: 0.8,
        },
        "48''": {
          min: 0.45,
          max: 0.55,
        },
      },
      "Upper Far": {
        "16''": {
          min: 0.1597,
          max: 0.2411,
        },
        "32''": {
          min: 0.297,
          max: 0.4554,
        },
        "48''": {
          min: 0.2487,
          max: 0.3804,
        },
      },
      "Lower Near": {
        "16''": {
          min: 0.7,
          max: 0.8,
        },
        "32''": {
          min: 0.7,
          max: 0.8,
        },
        "48''": {
          min: 0.45,
          max: 0.55,
        },
      },
      "Lower Far": {
        "16''": {
          min: 0.1533,
          max: 0.2323,
        },
        "32''": {
          min: 0.2852,
          max: 0.4387,
        },
        "48''": {
          min: 0.2389,
          max: 0.3667,
        },
      },
      "Tx Voltage (mV)": {
        "80''": {
          min: 20000,
          max: 20000,
        },
        "96''": {
          min: 20000,
          max: 20000,
        },
        "112''": {
          min: 20000,
          max: 20000,
        },
      },
      "Lower Rx Gain": {
        "80''": {
          min: 2,
          max: 2,
        },
        "96''": {
          min: 4,
          max: 4,
        },
        "112''": {
          min: 6,
          max: 6,
        },
      },
      "Deep Rx Gain": {
        "80''": {
          min: 7,
          max: 7,
        },
        "96''": {
          min: 7,
          max: 7,
        },
        "112''": {
          min: 7,
          max: 7,
        },
      },
      "Tx Current (mA)": {
        "80''": {
          min: 53.881,
          max: 130.2427,
        },
        "96''": {
          min: 56.7609,
          max: 130.3525,
        },
        "112''": {
          min: 55.0584,
          max: 130.9209,
        },
      },
      "Phase (deg)": {
        "80''": {
          min: -128.9601,
          max: 112.915,
        },
        "96''": {
          min: -150.3987,
          max: 121.507,
        },
        "112''": {
          min: -179.2852,
          max: 144.8821,
        },
        "50''": {
          min: -7.722,
          max: 31.4809,
        },
        "66''": {
          min: -54.964,
          max: 65.4964,
        },
        "82''": {
          min: -98.6145,
          max: 100.5019,
        },
      },
      "Phase Std Dev": {
        "80''": {
          min: -0.2364,
          max: 0.6149,
        },
        "96''": {
          min: -2.1577,
          max: 3.1015,
        },
        "112''": {
          min: -32.9457,
          max: 36.9901,
        },
        "50''": {
          min: -0.239,
          max: 0.6129,
        },
        "66''": {
          min: -2.1591,
          max: 3.101,
        },
        "82''": {
          min: -42.8964,
          max: 47.6719,
        },
      },
      "Amplitude (V)": {
        "80''": {
          min: -0.0,
          max: 0.0002,
        },
        "96''": {
          min: -0.0001,
          max: 0.0002,
        },
        "112''": {
          min: -0.0001,
          max: 0.0002,
        },
      },
      "Amplitude Std Dev": {
        "80''": {
          min: -0.0,
          max: 0.0,
        },
        "96''": {
          min: -0.0,
          max: 0.0,
        },
        "112''": {
          min: -0.0,
          max: 0.0,
        },
      },
      "Atten (dB)": {
        "50''": {
          min: 79.3497,
          max: 84.0341,
        },
        "66''": {
          min: 80.371,
          max: 82.4498,
        },
        "82''": {
          min: 80.8019,
          max: 82.1928,
        },
      },
      "Atten Std Dev": {
        "50''": {
          min: -0.8039,
          max: 0.867,
        },
        "66''": {
          min: -0.0005,
          max: 0.0024,
        },
        "82''": {
          min: -0.0006,
          max: 0.0026,
        },
      },
      "Lower Amplitude (V)": {
        "50''": {
          min: 0.5849,
          max: 1.7655,
        },
        "66''": {
          min: 0.1787,
          max: 1.9712,
        },
        "82''": {
          min: 0.1265,
          max: 2.0399,
        },
      },
      "Deep Amplitude (V)": {
        "50''": {
          min: -0.0,
          max: 0.0002,
        },
        "66''": {
          min: -0.0001,
          max: 0.0002,
        },
        "82''": {
          min: -0.0001,
          max: 0.0002,
        },
      },
      "Upper Tx Current (mA)": {
        "16''": {
          min: 11,
          max: 41,
        },
        "32''": {
          min: 28,
          max: 58,
        },
        "48''": {
          min: 12,
          max: 42,
        },
      },
      "Lower Tx Current (mA)": {
        "16''": {
          min: 11,
          max: 41,
        },
        "32''": {
          min: 28,
          max: 58,
        },
        "48''": {
          min: 12,
          max: 42,
        },
      },
    },
    "Low Gain 2 MHz": {
      "Upper Tx Voltage (mV)": {
        "16''": {
          min: 25.0977,
          max: 7752.2219,
        },
        "32''": {
          min: 4990.2665,
          max: 12736.5376,
        },
        "48''": {
          min: 5577.9767,
          max: 13988.0027,
        },
      },
      "Lower Tx Voltage (mV)": {
        "16''": {
          min: -26.6891,
          max: 8331.8437,
        },
        "32''": {
          min: 5172.8732,
          max: 13582.7969,
        },
        "48''": {
          min: 5902.8787,
          max: 15735.2656,
        },
      },
      Gain: {
        "16''": {
          min: 0,
          max: 0,
        },
        "32''": {
          min: 3,
          max: 3,
        },
        "48''": {
          min: 5,
          max: 5,
        },
      },
      "Upper Atten": {
        "16''": {
          min: 9.8818,
          max: 13.1067,
        },
        "32''": {
          min: 4.4674,
          max: 7.69,
        },
        "48''": {
          min: 2.5013,
          max: 5.7361,
        },
      },
      "Lower Atten": {
        "16''": {
          min: 9.9803,
          max: 13.1185,
        },
        "32''": {
          min: 4.639,
          max: 7.8714,
        },
        "48''": {
          min: 2.6761,
          max: 5.9327,
        },
      },
      "Expected Atten": {
        "16''": {
          min: 12.38,
          max: 12.38,
        },
        "32''": {
          min: 6.26,
          max: 6.26,
        },
        "48''": {
          min: 4.26,
          max: 4.26,
        },
        "50''": {
          min: 0,
          max: 0,
        },
        "66''": {
          min: 0,
          max: 0,
        },
        "82''": {
          min: 0,
          max: 0,
        },
      },
      "Upper Far": {
        "16''": {
          min: 0.1626,
          max: 0.2367,
        },
        "32''": {
          min: 0.3045,
          max: 0.4418,
        },
        "48''": {
          min: 0.3788,
          max: 0.5551,
        },
      },
      "Lower Far": {
        "16''": {
          min: 0.1625,
          max: 0.2348,
        },
        "32''": {
          min: 0.2965,
          max: 0.4349,
        },
        "48''": {
          min: 0.3682,
          max: 0.5466,
        },
      },
      "Tx Voltage (mV)": {
        "80''": {
          min: 0,
          max: 0,
        },
        "96''": {
          min: 0,
          max: 0,
        },
        "112''": {
          min: 0,
          max: 0,
        },
      },
      "Lower Rx Gain": {
        "80''": {
          min: 0,
          max: 0,
        },
        "96''": {
          min: 0,
          max: 0,
        },
        "112''": {
          min: 0,
          max: 0,
        },
      },
      "Deep Rx Gain": {
        "80''": {
          min: 0,
          max: 0,
        },
        "96''": {
          min: 0,
          max: 0,
        },
        "112''": {
          min: 0,
          max: 0,
        },
      },
      "Tx Current (mA)": {
        "80''": {
          min: 0,
          max: 0,
        },
        "96''": {
          min: 0,
          max: 0,
        },
        "112''": {
          min: 0,
          max: 0,
        },
      },
      "Phase (deg)": {
        "80''": {
          min: 0,
          max: 0,
        },
        "96''": {
          min: 0,
          max: 0,
        },
        "112''": {
          min: 0,
          max: 0,
        },
        "50''": {
          min: 0,
          max: 0,
        },
        "66''": {
          min: 0,
          max: 0,
        },
        "82''": {
          min: 0,
          max: 0,
        },
      },
      "Phase Std Dev": {
        "80''": {
          min: 0,
          max: 0,
        },
        "96''": {
          min: 0,
          max: 0,
        },
        "112''": {
          min: 0,
          max: 0,
        },
        "50''": {
          min: 0,
          max: 0,
        },
        "66''": {
          min: 0,
          max: 0,
        },
        "82''": {
          min: 0,
          max: 0,
        },
      },
      "Amplitude (V)": {
        "80''": {
          min: 0,
          max: 0,
        },
        "96''": {
          min: 0,
          max: 0,
        },
        "112''": {
          min: 0,
          max: 0,
        },
      },
      "Amplitude Std Dev": {
        "80''": {
          min: 0,
          max: 0,
        },
        "96''": {
          min: 0,
          max: 0,
        },
        "112''": {
          min: 0,
          max: 0,
        },
      },
      "Atten (dB)": {
        "50''": {
          min: 0,
          max: 0,
        },
        "66''": {
          min: 0,
          max: 0,
        },
        "82''": {
          min: 0,
          max: 0,
        },
      },
      "Atten Std Dev": {
        "50''": {
          min: 0,
          max: 0,
        },
        "66''": {
          min: 0,
          max: 0,
        },
        "82''": {
          min: 0,
          max: 0,
        },
      },
      "Lower Amplitude (V)": {
        "50''": {
          min: 0,
          max: 0,
        },
        "66''": {
          min: 0,
          max: 0,
        },
        "82''": {
          min: 0,
          max: 0,
        },
      },
      "Deep Amplitude (V)": {
        "50''": {
          min: 0,
          max: 0,
        },
        "66''": {
          min: 0,
          max: 0,
        },
        "82''": {
          min: 0,
          max: 0,
        },
      },
      "Upper Tx Current (mA)": {
        "16''": {
          min: -10,
          max: 30,
        },
        "32''": {
          min: 15,
          max: 55,
        },
        "48''": {
          min: 20,
          max: 60,
        },
      },
      "Lower Tx Current (mA)": {
        "16''": {
          min: -10,
          max: 30,
        },
        "32''": {
          min: 15,
          max: 55,
        },
        "48''": {
          min: 20,
          max: 60,
        },
      },
      "Upper Near": {
        "*": {
          min: 0.7,
          max: 0.8,
        },
      },
      "Lower Near": {
        "*": {
          min: 0.7,
          max: 0.8,
        },
      },
    },
    "*": {
      "Upper Phase": {
        "*": {
          min: -30,
          max: 30,
        },
      },
      "Lower Phase": {
        "*": {
          min: -30,
          max: 30,
        },
      },
      "Compensated Phase Std Dev": {
        "*": {
          max: 0.1,
        },
      },
      "Compensated Atten Std Dev": {
        "*": {
          max: 0.1,
        },
      },
      "Compensated Phase": {
        "16''": {
          pass: {
            min: -0.25,
            max: 0.25,
          },
          warn: {
            min: -0.3,
            max: 0.3,
          },
        },
        "32''": {
          pass: {
            min: -0.2,
            max: 0.2,
          },
          warn: {
            min: -0.25,
            max: 0.25,
          },
        },
        "48''": {
          pass: {
            min: -0.2,
            max: 0.2,
          },
          warn: {
            min: -0.25,
            max: 0.25,
          },
        },
      },
      "Atten Diff (Upper - Lower)": {
        "*": {
          pass: {
            min: -1.5,
            max: 1.5,
          },
          warn: {
            min: -2.5,
            max: 2.5,
          },
        },
      },
      "Phase Diff (Upper - Lower)": {
        "*": {
          min: -0.2,
          max: 0.2,
        },
      },
    },
  };

  // -----------------------------------------------------------------------
  // 2. AUTO-RULES — the report itself sometimes prints an "Expected X" row
  //    right next to the measured row (e.g. "Compensated Atten" next to
  //    "Expected Atten"). These rules use that as a live, self-supplied
  //    spec when SPEC above doesn't have an explicit entry, using a
  //    tolerance you set here (two-tier: pass/fail only). Set tolAbs to
  //    null to disable a rule.
  // -----------------------------------------------------------------------
  const AUTO_EXPECTED_RULES = [
    // Engineering spec: "Compensated Atten = ±0.15 of Expected Atten" —
    // reads each report's own Expected Atten cell as the live reference.
    { valueParam: "Compensated Atten", expectedParam: "Expected Atten", tolAbs: 0.15 },
    // No engineering spec given for the Deep Resistivity "Atten (dB)" row
    // (different measurement) — left at the original placeholder tolerance.
    { valueParam: "Atten (dB)", expectedParam: "Expected Atten", tolAbs: 0.5 },
  ];

  // -----------------------------------------------------------------------
  // 3. DERIVED CHECKS — computed from two existing rows in the same
  //    sub-table (e.g. Upper Atten minus Lower Atten). Each one adds a new
  //    row to the table showing the computed value, checked against SPEC
  //    under resultParam exactly like any other parameter (two-tier or
  //    three-tier, your choice). Add more rules the same way if you need
  //    other differences checked later.
  // -----------------------------------------------------------------------
  const DERIVED_CHECKS = [
    {
      resultParam: "Atten Diff (Upper - Lower)",
      aParam: "Upper Atten",
      bParam: "Lower Atten",
      op: (a, b) => a - b,
    },
    {
      resultParam: "Phase Diff (Upper - Lower)",
      aParam: "Upper Phase",
      bParam: "Lower Phase",
      op: (a, b) => a - b,
    },
  ];

  // Section container ids as they appear in the report's own DOM.
  const SECTION_IDS = {
    "High Gain 500 kHz": "High Gain500 kHzTable",
    "High Gain 2 MHz": "High Gain2 MHzTable",
    "Low Gain 500 kHz": "Low Gain500 kHzTable",
    "Low Gain 2 MHz": "Low Gain2 MHzTable",
  };

  // -----------------------------------------------------------------------
  // 4. TITLE GATE — the report's own on-page title (a <span> near the very
  //    top of <body>, e.g. "Quasar ADR Airhang Report" — NOT the browser
  //    tab's <title> tag, which this report leaves empty) is used as a
  //    safety check before doing anything else:
  //      - If the title's first word isn't "Quasar" or "ComRes", this
  //        probably isn't an Airhang report (or it's some other tool's
  //        output) — the script alerts and stops without touching the page.
  //      - If the first word IS "Quasar", after the scan finishes it's
  //        rewritten to "ComRes" (rest of the title untouched). That marks
  //        the report as having been run through this checker, and makes
  //        re-running it later a no-op on this check (title already starts
  //        with "ComRes").
  // -----------------------------------------------------------------------
  function findTitleSpan() {
    const spans = document.querySelectorAll("span");
    for (const s of spans) {
      const t = s.textContent.trim();
      if (/^(quasar|comres)\b/i.test(t) && /airhang/i.test(t)) return s;
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Below this line is scanning/highlighting engine — shouldn't need edits.
  // -----------------------------------------------------------------------

  function lookupSpec(section, param, spacing) {
    const bySection = SPEC[section] && SPEC[section][param];
    if (bySection) {
      if (bySection[spacing]) return bySection[spacing];
      if (bySection["*"]) return bySection["*"];
    }
    const wild = SPEC["*"] && SPEC["*"][param];
    if (wild) {
      if (wild[spacing]) return wild[spacing];
      if (wild["*"]) return wild["*"];
    }
    return null;
  }

  // Turns a single range definition ({min,max} or {expected,tol/tolPct})
  // into a concrete {lo, hi}. Returns null if the definition is missing.
  function rangeOf(def) {
    if (!def) return null;
    let lo = -Infinity,
      hi = Infinity;
    if (typeof def.min === "number") lo = def.min;
    if (typeof def.max === "number") hi = def.max;
    if (typeof def.expected === "number") {
      let tol = 0;
      if (typeof def.tol === "number") tol = def.tol;
      if (typeof def.tolPct === "number") tol = (Math.abs(def.expected) * def.tolPct) / 100;
      lo = def.expected - tol;
      hi = def.expected + tol;
    }
    return { lo, hi };
  }

  function inRange(range, value) {
    return !!range && value >= range.lo && value <= range.hi;
  }

  // Evaluates a value against a spec entry, two-tier or three-tier.
  // Returns { status: 'pass'|'warn'|'fail', passRange, warnRange } or null
  // if no spec was supplied at all.
  function evalSpec(spec, value) {
    if (!spec) return null;
    const isThreeTier = spec.pass || spec.warn;
    if (isThreeTier) {
      const passRange = rangeOf(spec.pass);
      const warnRange = rangeOf(spec.warn);
      if (inRange(passRange, value)) return { status: "pass", passRange, warnRange };
      if (inRange(warnRange, value)) return { status: "warn", passRange, warnRange };
      return { status: "fail", passRange, warnRange };
    }
    // Legacy two-tier: the spec object itself is the pass range.
    const passRange = rangeOf(spec);
    return { status: inRange(passRange, value) ? "pass" : "fail", passRange, warnRange: null };
  }

  function fmtRange(r) {
    if (!r) return "n/a";
    const lo = r.lo === -Infinity ? "-inf" : r.lo.toFixed(4);
    const hi = r.hi === Infinity ? "+inf" : r.hi.toFixed(4);
    return `${lo} to ${hi}`;
  }

  function findAutoRule(param) {
    return AUTO_EXPECTED_RULES.find((r) => r.valueParam === param && r.tolAbs != null);
  }

  function styleCell(cell, status, tooltip) {
    cell.setAttribute("data-adrqc", status);
    cell.title = tooltip || "";
    const styles = {
      pass: { bg: "#d7f5d7", fg: "#0a5c0a", border: "1px solid #4caf50" },
      warn: { bg: "#ffe4b5", fg: "#8a4b00", border: "1px solid #ff9800" },
      fail: { bg: "#ffd6d6", fg: "#8a0000", border: "1px solid #e53935" },
      nospec: { bg: "#fff6cc", fg: "#6b5900", border: "1px solid #e0c200" },
      na: { bg: "#f0f0f0", fg: "#999999", border: "1px solid #dddddd" },
    };
    const s = styles[status];
    if (!s) return;
    cell.style.backgroundColor = s.bg;
    cell.style.color = s.fg;
    cell.style.border = s.border;
    cell.style.fontWeight = status === "fail" || status === "warn" ? "bold" : cell.style.fontWeight;
  }

  // Computes and inserts DERIVED_CHECKS rows for one data table, using the
  // rowByParam/spacings already gathered for that table. Pushes results
  // into `results` the same as a normal scanned cell.
  function applyDerivedChecks(sectionName, table, rowByParam, spacings, results) {
    DERIVED_CHECKS.forEach((rule) => {
      const aCells = rowByParam[rule.aParam];
      const bCells = rowByParam[rule.bParam];
      if (!aCells || !bCells) return; // this table doesn't have both source rows

      const tr = document.createElement("tr");
      tr.setAttribute("data-adrqc-derived", "1");
      const labelTd = document.createElement("td");
      labelTd.textContent = rule.resultParam;
      labelTd.style.fontStyle = "italic";
      tr.appendChild(labelTd);

      for (let i = 1; i < aCells.length; i++) {
        const spacing = spacings[i - 1] || "col" + i;
        const td = document.createElement("td");
        const aRaw = aCells[i] ? aCells[i].textContent.trim() : "";
        const bRaw = bCells[i] ? bCells[i].textContent.trim() : "";

        const missing =
          !aRaw || !bRaw || aRaw.toLowerCase() === "na" || bRaw.toLowerCase() === "na";
        if (missing) {
          td.textContent = "na";
          styleCell(td, "na", "No data (na)");
          tr.appendChild(td);
          continue;
        }

        const aVal = parseFloat(aRaw),
          bVal = parseFloat(bRaw);
        if (Number.isNaN(aVal) || Number.isNaN(bVal)) {
          td.textContent = "";
          tr.appendChild(td);
          continue;
        }

        const diff = rule.op(aVal, bVal);
        td.textContent = diff.toFixed(6);

        const spec = lookupSpec(sectionName, rule.resultParam, spacing);
        const evaluated = evalSpec(spec, diff);
        const record = {
          section: sectionName,
          param: rule.resultParam,
          spacing,
          value: diff,
          spec,
          status: evaluated ? evaluated.status : "nospec",
          cell: td,
        };

        if (!evaluated) {
          styleCell(
            td,
            "nospec",
            `${rule.resultParam} @ ${spacing}\nValue: ${diff.toFixed(6)} (= ${rule.aParam} \u2212 ${rule.bParam})\nNo spec defined`,
          );
        } else {
          styleCell(
            td,
            evaluated.status,
            `${rule.resultParam} @ ${spacing}\n` +
              `Value: ${diff.toFixed(6)} (= ${rule.aParam} \u2212 ${rule.bParam})\n` +
              `Pass range: ${fmtRange(evaluated.passRange)}\n` +
              (evaluated.warnRange ? `Warn range: ${fmtRange(evaluated.warnRange)}\n` : "") +
              `Status: ${evaluated.status.toUpperCase()}`,
          );
        }

        results.push(record);
        tr.appendChild(td);
      }

      table.appendChild(tr);
    });
  }

  function scanSection(sectionName, containerId, results) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const tables = container.querySelectorAll("table");
    tables.forEach((table) => {
      const rows = Array.from(table.rows || table.querySelectorAll("tr"));
      if (!rows.length) return;
      const headerCells = Array.from(rows[0].cells || []);
      if (!headerCells.length) return;
      const headerLabel = headerCells[0].textContent.trim();
      if (headerLabel !== "Spacing") return; // not a data table
      const spacings = headerCells.slice(1).map((td) => td.textContent.trim());

      // Quick lookup of value cells by param name — used both by AUTO
      // rules (reading a sibling "Expected X" row) and DERIVED_CHECKS.
      const rowByParam = {};
      rows.slice(1).forEach((r) => {
        const cells = Array.from(r.cells || []);
        if (!cells.length) return;
        const paramName = cells[0].textContent.trim();
        if (paramName) rowByParam[paramName] = cells;
      });

      rows.slice(1).forEach((r) => {
        const cells = Array.from(r.cells || []);
        if (!cells.length) return;
        const paramName = cells[0].textContent.trim();
        if (!paramName) return;

        for (let i = 1; i < cells.length; i++) {
          const cell = cells[i];
          const spacing = spacings[i - 1] || "col" + i;
          const raw = cell.textContent.trim();
          if (raw === "" || raw.toLowerCase() === "na") {
            styleCell(cell, "na", "No data (na)");
            continue;
          }
          const value = parseFloat(raw);
          if (Number.isNaN(value)) {
            continue; // non-numeric, leave alone
          }

          let spec = lookupSpec(sectionName, paramName, spacing);
          let specSource = "manual";

          if (!spec) {
            const rule = findAutoRule(paramName);
            if (rule) {
              const expCells = rowByParam[rule.expectedParam];
              if (expCells && expCells[i]) {
                const expRaw = expCells[i].textContent.trim();
                const expVal = parseFloat(expRaw);
                if (!Number.isNaN(expVal)) {
                  spec = { expected: expVal, tol: rule.tolAbs };
                  specSource = "auto (" + rule.expectedParam + ")";
                }
              }
            }
          }

          const evaluated = evalSpec(spec, value);
          const record = {
            section: sectionName,
            param: paramName,
            spacing,
            value,
            spec,
            specSource,
            status: null,
          };

          if (!evaluated) {
            record.status = "nospec";
            styleCell(
              cell,
              "nospec",
              `${paramName} @ ${spacing}\nValue: ${value}\nNo spec defined`,
            );
          } else {
            record.status = evaluated.status;
            styleCell(
              cell,
              record.status,
              `${paramName} @ ${spacing}\n` +
                `Value: ${value}\n` +
                `Spec (${specSource}) pass range: ${fmtRange(evaluated.passRange)}\n` +
                (evaluated.warnRange ? `Warn range: ${fmtRange(evaluated.warnRange)}\n` : "") +
                `Status: ${evaluated.status.toUpperCase()}`,
            );
          }
          record.cell = cell;
          results.push(record);
        }
      });

      applyDerivedChecks(sectionName, table, rowByParam, spacings, results);
    });
  }

  function runScan() {
    // Remove any highlighting/derived rows from a previous run first.
    document.querySelectorAll("tr[data-adrqc-derived]").forEach((el) => el.remove());
    document.querySelectorAll("[data-adrqc]").forEach((el) => {
      el.removeAttribute("data-adrqc");
      el.style.backgroundColor = "";
      el.style.color = "";
      el.style.border = "";
      el.style.fontWeight = "";
      el.title = "";
    });
    const results = [];
    Object.entries(SECTION_IDS).forEach(([name, id]) => scanSection(name, id, results));
    return results;
  }

  // Inserts (or replaces) a permanent, printable summary block right after
  // the report's own title — unlike the floating panel (position:fixed,
  // screen-only), this becomes part of the actual document: it survives
  // "Save Page As" / printing to PDF, and is the first thing anyone sees if
  // this saved copy is reopened later without re-running the checker.
  // Auto-expanded when there's something to see, collapsed when all clear.
  function buildInlineSummary(results, titleSpan) {
    const old = document.getElementById("adrqc-inline-summary");
    if (old) old.remove();

    const pass = results.filter((r) => r.status === "pass").length;
    const warn = results.filter((r) => r.status === "warn").length;
    const fail = results.filter((r) => r.status === "fail").length;
    const nospec = results.filter((r) => r.status === "nospec").length;
    const naCount = results.filter((r) => r.status === "na").length;
    const issues = results.filter((r) => r.status === "fail" || r.status === "warn");

    const details = document.createElement("details");
    details.id = "adrqc-inline-summary";
    details.open = issues.length > 0;
    details.style.cssText = `
      margin: 12px 0 18px; padding: 10px 14px; max-width: 640px;
      border: 2px solid #333; border-radius: 6px; background: #fafafa;
      font-family: Tahoma, Arial, sans-serif; font-size: 13px;
    `;

    const summary = document.createElement("summary");
    summary.style.cssText = "cursor:pointer; font-weight:bold; font-size:14px;";
    summary.innerHTML =
      `ComRes Airhang Check — ` +
      `<span style="color:#0a5c0a;">${pass} pass</span>, ` +
      `<span style="color:#8a4b00;">${warn} warn</span>, ` +
      `<span style="color:#8a0000;">${fail} fail</span>, ` +
      `<span style="color:#6b5900;">${nospec} no-spec</span>, ` +
      `<span style="color:#999;">${naCount} na</span>`;
    details.appendChild(summary);

    const body = document.createElement("div");
    body.style.cssText = "margin-top:8px;";
    let bodyHtml = `<div style="color:#555; margin-bottom:6px;">Checked ${new Date().toLocaleString()}</div>`;
    if (issues.length) {
      bodyHtml += `<div style="font-weight:bold; margin-bottom:4px;">Warnings &amp; Failures:</div><ul style="margin:0; padding-left:18px;">`;
      issues.forEach((r, i) => {
        const color = r.status === "fail" ? "#8a0000" : "#8a4b00";
        const tag = r.status === "fail" ? "FAIL" : "WARN";
        const val = typeof r.value === "number" ? r.value.toFixed(4) : r.value;
        bodyHtml +=
          `<li style="margin-bottom:2px;"><a href="#" data-idx="${i}" class="adrqc-inline-jump" ` +
          `style="color:${color}; font-weight:bold; text-decoration:underline; cursor:pointer;">` +
          `[${tag}] ${r.section} / ${r.param} @ ${r.spacing}</a> = ${val}</li>`;
      });
      bodyHtml += `</ul>`;
    } else {
      bodyHtml += `<div style="color:#0a5c0a;">No warnings or failures against current spec.</div>`;
    }
    body.innerHTML = bodyHtml;
    details.appendChild(body);

    body.querySelectorAll(".adrqc-inline-jump").forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        const idx = parseInt(a.getAttribute("data-idx"), 10);
        const rec = issues[idx];
        if (rec && rec.cell) {
          rec.cell.scrollIntoView({ behavior: "smooth", block: "center" });
          rec.cell.style.outline = "3px solid #ff5722";
          setTimeout(() => {
            rec.cell.style.outline = "";
          }, 1500);
        }
      };
    });

    titleSpan.insertAdjacentElement("afterend", details);
  }

  function buildPanel(results) {
    const old = document.getElementById("adrqc-panel");
    if (old) old.remove();

    const pass = results.filter((r) => r.status === "pass").length;
    const warn = results.filter((r) => r.status === "warn").length;
    const fail = results.filter((r) => r.status === "fail").length;
    const nospec = results.filter((r) => r.status === "nospec").length;
    const naCount = results.filter((r) => r.status === "na").length;

    const issues = results.filter((r) => r.status === "fail" || r.status === "warn");
    const issueList = issues
      .map((r, i) => {
        const color = r.status === "fail" ? "#8a0000" : "#8a4b00";
        const tag = r.status === "fail" ? "FAIL" : "WARN";
        return `<li style="margin-bottom:4px;"><a href="#" data-idx="${i}" class="adrqc-jump" style="color:${color}; font-weight:bold;">[${tag}] ${r.section} / ${r.param} @ ${r.spacing}</a> = ${typeof r.value === "number" ? r.value.toFixed(4) : r.value}</li>`;
      })
      .join("");

    const panel = document.createElement("div");
    panel.id = "adrqc-panel";
    panel.style.cssText = `
      position: fixed; top: 12px; right: 12px; width: 300px; max-height: 85vh;
      overflow-y: auto; background: #ffffff; border: 2px solid #333;
      border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      font-family: Tahoma, Arial, sans-serif; font-size: 12px; z-index: 999999;
      padding: 10px;
    `;

    panel.innerHTML = `
      <div style="font-weight:bold; font-size:14px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
        <span>ComRes Airhang Check</span>
        <button id="adrqc-close" style="cursor:pointer; border:none; background:none; font-size:16px; line-height:1;">&times;</button>
      </div>
      <div style="margin-bottom:8px;">
        <span style="color:#0a5c0a; font-weight:bold;">${pass} pass</span> &nbsp;
        <span style="color:#8a4b00; font-weight:bold;">${warn} warn</span> &nbsp;
        <span style="color:#8a0000; font-weight:bold;">${fail} fail</span> &nbsp;
        <span style="color:#6b5900; font-weight:bold;">${nospec} no-spec</span> &nbsp;
        <span style="color:#999; font-weight:bold;">${naCount} na</span>
      </div>
      <div style="margin-bottom:8px; display:flex; gap:6px; flex-wrap:wrap;">
        <button id="adrqc-rescan" style="cursor:pointer;">Rescan</button>
        <button id="adrqc-editspec" style="cursor:pointer;">Edit Spec / Export</button>
      </div>
      ${
        issues.length
          ? `<div style="font-weight:bold; margin-bottom:4px;">Warnings &amp; Failures:</div>
      <ul style="padding-left:16px; margin:0 0 8px 0;">${issueList}</ul>`
          : `<div style="color:#0a5c0a;">No warnings or failures against current spec.</div>`
      }
      <div id="adrqc-editor" style="display:none; margin-top:8px; border-top:1px solid #ccc; padding-top:8px;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById("adrqc-close").onclick = () => panel.remove();
    document.getElementById("adrqc-rescan").onclick = () => {
      const r = runScan();
      buildPanel(r);
      buildInlineSummary(r, titleSpan);
    };
    panel.querySelectorAll(".adrqc-jump").forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        const idx = parseInt(a.getAttribute("data-idx"), 10);
        const rec = issues[idx];
        if (rec && rec.cell) {
          rec.cell.scrollIntoView({ behavior: "smooth", block: "center" });
          rec.cell.style.outline = "3px solid #ff5722";
          setTimeout(() => {
            rec.cell.style.outline = "";
          }, 1500);
        }
      };
    });

    document.getElementById("adrqc-editspec").onclick = () => {
      const ed = document.getElementById("adrqc-editor");
      if (ed.style.display === "none") {
        ed.style.display = "block";
        buildEditor(ed, results);
      } else {
        ed.style.display = "none";
      }
    };
  }

  function buildEditor(container, results) {
    // Build a skeleton of every distinct section/param/spacing found or
    // computed (including DERIVED_CHECKS rows), pre-filled with existing
    // SPEC values where present, so it's easy to see exactly what to add.
    // Three-tier params (pass+warn already defined) keep that shape;
    // everything else defaults to a fillable two-tier skeleton.
    const seen = {};
    results.forEach((r) => {
      seen[r.section] = seen[r.section] || {};
      seen[r.section][r.param] = seen[r.section][r.param] || {};
      seen[r.section][r.param][r.spacing] = true;
    });
    const skeleton = {};
    Object.entries(seen).forEach(([section, params]) => {
      skeleton[section] = {};
      Object.entries(params).forEach(([param, spacings]) => {
        const existing = (SPEC[section] && SPEC[section][param]) || {};
        skeleton[section][param] = {};
        Object.keys(spacings).forEach((sp) => {
          skeleton[section][param][sp] = existing[sp] || existing["*"] || { min: null, max: null };
        });
      });
    });

    container.innerHTML = `
      <div style="margin-bottom:6px;">Paste-editable spec (found/computed-in-report skeleton, merged with current SPEC). Use <code>{min,max}</code> or <code>{expected,tol}</code> for pass/fail only, or <code>{pass:{...}, warn:{...}}</code> for pass/warning/fail. Edit, click Apply to test live, or Copy/Download to save permanently into the SPEC constant in the source file.</div>
      <textarea id="adrqc-spec-text" style="width:100%; height:220px; font-family:monospace; font-size:11px;">${JSON.stringify(skeleton, null, 2)}</textarea>
      <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
        <button id="adrqc-apply">Apply (this session)</button>
        <button id="adrqc-copy">Copy JSON</button>
        <button id="adrqc-download">Download spec.json</button>
      </div>
      <div id="adrqc-editor-msg" style="margin-top:4px; color:#555;"></div>
    `;

    document.getElementById("adrqc-apply").onclick = () => {
      const msg = document.getElementById("adrqc-editor-msg");
      try {
        const parsed = JSON.parse(document.getElementById("adrqc-spec-text").value);
        Object.assign(SPEC, parsed);
        msg.textContent = "Applied. Rescanning...";
        const r = runScan();
        buildPanel(r);
        buildInlineSummary(r, titleSpan);
      } catch (e) {
        msg.textContent = "JSON error: " + e.message;
        msg.style.color = "#8a0000";
      }
    };
    document.getElementById("adrqc-copy").onclick = () => {
      const text = document.getElementById("adrqc-spec-text").value;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          document.getElementById("adrqc-editor-msg").textContent = "Copied to clipboard.";
        })
        .catch(() => {
          document.getElementById("adrqc-editor-msg").textContent =
            "Copy failed — select text manually.";
        });
    };
    document.getElementById("adrqc-download").onclick = () => {
      const text = document.getElementById("adrqc-spec-text").value;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "adr-airhang-spec.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
  }

  // -----------------------------------------------------------------------
  // Entry point
  // -----------------------------------------------------------------------
  const titleSpan = findTitleSpan();
  if (!titleSpan) {
    alert(
      "ComRes Airhang Check: couldn't find a report title starting with " +
        '"Quasar" or "ComRes" on this page. This doesn\'t look like an ' +
        "Airhang report — stopping without changing anything.",
    );
    return;
  }
  const titleText = titleSpan.textContent.trim();
  const titleFirstWord = titleText.split(/\s+/)[0] || "";
  if (!/^(quasar|comres)$/i.test(titleFirstWord)) {
    alert(
      `ComRes Airhang Check: report title starts with "${titleFirstWord}", ` +
        `not "Quasar" or "ComRes" — stopping without changing anything.`,
    );
    return;
  }

  const results = runScan();
  buildPanel(results);
  buildInlineSummary(results, titleSpan);
  console.log(
    `ComRes Airhang Check: scanned ${results.length} values — ` +
      `${results.filter((r) => r.status === "pass").length} pass, ` +
      `${results.filter((r) => r.status === "warn").length} warn, ` +
      `${results.filter((r) => r.status === "fail").length} fail, ` +
      `${results.filter((r) => r.status === "nospec").length} no-spec, ` +
      `${results.filter((r) => r.status === "na").length} na.`,
  );

  // Mark the report as checked: "Quasar ..." -> "ComRes ..." (rest of the
  // title left untouched). Only fires the first time — on a later re-run
  // the title already starts with "ComRes" and this is skipped.
  if (/^quasar$/i.test(titleFirstWord)) {
    titleSpan.textContent = "ComRes" + titleText.slice(titleFirstWord.length);
    console.log('ComRes Airhang Check: title updated from "Quasar..." to "ComRes..."');
  }
})();
