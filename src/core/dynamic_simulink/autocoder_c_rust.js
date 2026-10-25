/**
 * Experimental C, AUTOSAR XML, and Rust code generation examples
 *
 * Compiles dynamic control systems, discrete filters, and multi-rate state-space
 * models into code examples. Generated output has not been compiled, qualified, or
 * assessed for MISRA, AUTOSAR, avionics, or other safety requirements.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class AutocoderCRust {
  static validateModelSpec(modelSpec) {
    if (!modelSpec || typeof modelSpec !== 'object' || Array.isArray(modelSpec)) {
      throw new TypeError('Controller code generation requires an explicit modelSpec object.');
    }
    if (typeof modelSpec.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(modelSpec.name)) {
      throw new TypeError('modelSpec.name must be an identifier suitable for generated code.');
    }
    if (!Number.isFinite(modelSpec.sampleRateHz) || modelSpec.sampleRateHz <= 0 || modelSpec.sampleRateHz > 1e6) {
      throw new TypeError('modelSpec.sampleRateHz must be explicit, positive, and at most 1,000,000 Hz.');
    }
    const matrices = ['A', 'B', 'C', 'K'];
    for (const name of matrices) {
      const matrix = modelSpec[name];
      if (
        !Array.isArray(matrix) ||
        matrix.length === 0 ||
        matrix.length > 128 ||
        !matrix.every((row) => Array.isArray(row) && row.length > 0 && row.length <= 128 && row.every(Number.isFinite))
      ) {
        throw new TypeError(`modelSpec.${name} must be a nonempty finite matrix.`);
      }
      if (matrix.some((row) => row.length !== matrix[0].length)) {
        throw new TypeError(`modelSpec.${name} must be rectangular.`);
      }
    }
    const n = modelSpec.A.length;
    const m = modelSpec.B[0].length;
    const p = modelSpec.C.length;
    if (
      modelSpec.A[0].length !== n ||
      modelSpec.B.length !== n ||
      modelSpec.C[0].length !== n ||
      modelSpec.K.length !== m ||
      modelSpec.K[0].length !== n
    ) {
      throw new TypeError('modelSpec matrix dimensions must satisfy square A, compatible B/C, and K dimensions m×n.');
    }
    return modelSpec;
  }

  /**
   * Generates an experimental C header and implementation example for a state-space controller.
   * @param {Object} modelSpec
   * @param {string} [modelSpec.name='flight_controller']
   * @param {number[][]} modelSpec.A - System matrix (n x n)
   * @param {number[][]} modelSpec.B - Input matrix (n x m)
   * @param {number[][]} modelSpec.C - Output matrix (p x n)
   * @param {number[][]} modelSpec.K - LQR gain matrix (m x n)
   * @param {number} [modelSpec.sampleRateHz=1000]
   * @param {string} [modelSpec.standard='MISRA-C:2023']
   * @returns {{headerCode: string, sourceCode: string, standard: string}}
   */
  static generateMisraC(modelSpec) {
    this.validateModelSpec(modelSpec);
    const { name, A, B, C } = modelSpec;
    const n = A.length;
    const m = B[0].length;
    const p = C.length;
    const dt = 1.0 / modelSpec.sampleRateHz;
    const standard = modelSpec.standard || 'not specified';

    const macroPrefix = name.toUpperCase();

    // 1. Header file
    const headerCode = `/*
 * Experimental controller code example
 * Requested standard label: ${standard} (not assessed)
 * Target support, conformance, memory bounds, and real-time timing have not been assessed.
 * Generated arrays are fixed-size; runtime stack and allocation behavior are not qualified.
 */

#ifndef ${macroPrefix}_H
#define ${macroPrefix}_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Explicit width IEEE 754 float alias */
typedef float float32_t;

#define ${macroPrefix}_STATE_DIM  (${n}U)
#define ${macroPrefix}_INPUT_DIM  (${m}U)
#define ${macroPrefix}_OUTPUT_DIM (${p}U)
#define ${macroPrefix}_SAMPLE_DT  (${dt.toFixed(6)}f)

/* Inputs structure */
typedef struct {
    float32_t reference[${p}U];
    float32_t measurement[${n}U];
} ${name}_inputs_t;

/* Outputs structure */
typedef struct {
    float32_t control_effort[${m}U];
} ${name}_outputs_t;

/* Static persistent state */
typedef struct {
    float32_t x[${n}U];
    uint32_t step_counter;
} ${name}_state_t;

/* Function prototypes */
void ${name}_init(${name}_state_t * const state);
void ${name}_step(
    ${name}_state_t * const state,
    const ${name}_inputs_t * const in,
    ${name}_outputs_t * const out
);

#ifdef __cplusplus
}
#endif

#endif /* ${macroPrefix}_H */
`;

    // 2. Source file
    const K = modelSpec.K;

    const formatMatrixC = (M, nRows, nCols) => {
      let str = '{\n';
      for (let r = 0; r < nRows; r++) {
        str += '        { ';
        for (let c = 0; c < nCols; c++) {
          const val = M[r] && M[r][c] !== undefined ? M[r][c] : 0.0;
          str += `${val.toFixed(6)}f${c < nCols - 1 ? ', ' : ''}`;
        }
        str += ` }${r < nRows - 1 ? ',\n' : '\n'}`;
      }
      str += '    }';
      return str;
    };

    const sourceCode = `/*
 * Experimental controller source example
 * Requested standard label: ${standard} (not assessed)
 */

#include "${name}.h"

/* Static gain and state transition matrices */
static const float32_t K_GAIN[${m}U][${n}U] = ${formatMatrixC(K, m, n)};
static const float32_t A_MAT[${n}U][${n}U] = ${formatMatrixC(A, n, n)};
static const float32_t B_MAT[${n}U][${m}U] = ${formatMatrixC(B, n, m)};

/* Controller initialization */
void ${name}_init(${name}_state_t * const state)
{
    uint32_t i;
    if (state != (void *)0) {
        for (i = 0U; i < ${macroPrefix}_STATE_DIM; i++) {
            state->x[i] = 0.0f;
        }
        state->step_counter = 0U;
    }
}

/* Example controller update; execution time and runtime memory behavior are not qualified. */
void ${name}_step(
    ${name}_state_t * const state,
    const ${name}_inputs_t * const in,
    ${name}_outputs_t * const out
)
{
    uint32_t i;
    uint32_t j;
    float32_t u_ctrl[${m}U];
    float32_t x_next[${n}U];

    if ((state == (void *)0) || (in == (void *)0) || (out == (void *)0)) {
        return;
    }

    /* 1. Compute control effort u = -K * x */
    for (i = 0U; i < ${macroPrefix}_INPUT_DIM; i++) {
        u_ctrl[i] = 0.0f;
        for (j = 0U; j < ${macroPrefix}_STATE_DIM; j++) {
            /* Parentheses show the intended grouping for the state error. */
            const float32_t error = (j < ${macroPrefix}_OUTPUT_DIM) ? 
                (in->reference[j] - in->measurement[j]) : (-in->measurement[j]);
            u_ctrl[i] += (K_GAIN[i][j] * error);
        }
        /* Saturation safeguard */
        if (u_ctrl[i] > 100.0f) {
            u_ctrl[i] = 100.0f;
        } else if (u_ctrl[i] < -100.0f) {
            u_ctrl[i] = -100.0f;
        } else {
            /* Within limits */
        }
        out->control_effort[i] = u_ctrl[i];
    }

    /* 2. Update state observer x_next = A * x + B * u */
    for (i = 0U; i < ${macroPrefix}_STATE_DIM; i++) {
        x_next[i] = 0.0f;
        for (j = 0U; j < ${macroPrefix}_STATE_DIM; j++) {
            x_next[i] += (A_MAT[i][j] * state->x[j]);
        }
        for (j = 0U; j < ${macroPrefix}_INPUT_DIM; j++) {
            x_next[i] += (B_MAT[i][j] * u_ctrl[j]);
        }
    }

    for (i = 0U; i < ${macroPrefix}_STATE_DIM; i++) {
        state->x[i] = x_next[i];
    }

    state->step_counter = state->step_counter + 1U;
}
`;

    return { headerCode, sourceCode, standard };
  }

  /**
   * Generates an AUTOSAR-shaped SWC and ARXML example; format/schema conformance is not assessed.
   * @param {Object} modelSpec
   * @returns {{swcHeader: string, swcSource: string, arxml: string}}
   */
  static generateAutosarSWC(modelSpec) {
    this.validateModelSpec(modelSpec);
    const name = modelSpec.name;
    const sampleTimeMs = Number((1000.0 / modelSpec.sampleRateHz).toFixed(6));

    const swcHeader = `/*
 * Experimental AUTOSAR-shaped software component example: ${name}
 * Requested format label: AUTOSAR Classic 4.4 / CP (not assessed)
 */

#ifndef RTE_${name.toUpperCase()}_H
#define RTE_${name.toUpperCase()}_H

#include "Std_Types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Application Types */
typedef float32 Idt_Real32;

/* RTE API Prototypes */
Std_ReturnType Rte_Read_rpReference_Value(Idt_Real32 *data);
Std_ReturnType Rte_Read_rpFeedback_Value(Idt_Real32 *data);
Std_ReturnType Rte_Write_ppActuator_Command(Idt_Real32 data);

/* Runnable Entities */
void RE_${name}_Init(void);
void RE_${name}_Step(void);

#ifdef __cplusplus
}
#endif

#endif /* RTE_${name.toUpperCase()}_H */
`;

    const swcSource = `/*
 * Experimental runnable-shaped source example: ${name}
 * Example sample interval: ${sampleTimeMs}ms; no runtime integration is established.
 */

#include "Rte_${name}.h"

static Idt_Real32 s_integralState = 0.0f;

void RE_${name}_Init(void)
{
    s_integralState = 0.0f;
}

void RE_${name}_Step(void)
{
    Idt_Real32 refVal = 0.0f;
    Idt_Real32 fbkVal = 0.0f;
    Idt_Real32 cmdVal = 0.0f;

    if (Rte_Read_rpReference_Value(&refVal) == RTE_E_OK) {
        if (Rte_Read_rpFeedback_Value(&fbkVal) == RTE_E_OK) {
            const Idt_Real32 error = refVal - fbkVal;
            s_integralState += (error * ${(1.0 / modelSpec.sampleRateHz).toFixed(6)}f);
            cmdVal = (error * 2.5f) + (s_integralState * 0.8f);
            
            /* Anti-windup clamping */
            if (cmdVal > 100.0f) {
                cmdVal = 100.0f;
            } else if (cmdVal < -100.0f) {
                cmdVal = -100.0f;
            } else {
                /* In nominal range */
            }

            (void)Rte_Write_ppActuator_Command(cmdVal);
        }
    }
}
`;

    const arxml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Experimental AUTOSAR-shaped XML example; schema and tool conformance are not assessed. -->
<AUTOSAR xmlns="http://autosar.org/schema/r4.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Components</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>${name}</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>rpReference</SHORT-NAME>
            </R-PORT-PROTOTYPE>
            <R-PORT-PROTOTYPE>
              <SHORT-NAME>rpFeedback</SHORT-NAME>
            </R-PORT-PROTOTYPE>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>ppActuator</SHORT-NAME>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>${name}_InternalBehavior</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_${name}_Step</SHORT-NAME>
                  <CAN-BE-INVOKED-CONCURRENTLY>false</CAN-BE-INVOKED-CONCURRENTLY>
                  <SYMBOL>RE_${name}_Step</SYMBOL>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>
`;

    return { swcHeader, swcSource, arxml };
  }

  /**
   * Generates a #![no_std] Rust code example with fixed-size arrays.
   * Memory safety, allocation behavior, avionics, and safety use are not qualified.
   * @param {Object} modelSpec
   * @returns {string} Rust source code
   */
  static generateNoStdRust(modelSpec) {
    this.validateModelSpec(modelSpec);
    const { name, A, B, C } = modelSpec;
    const n = A.length;
    const m = B[0].length;
    const p = C.length;
    const dt = 1.0 / modelSpec.sampleRateHz;

    const K = modelSpec.K;

    const formatMatrixRust = (M, nRows, nCols) => {
      let str = '[\n';
      for (let r = 0; r < nRows; r++) {
        str += '        [';
        for (let c = 0; c < nCols; c++) {
          const val = M[r] && M[r][c] !== undefined ? M[r][c] : 0.0;
          str += `${val.toFixed(6)}_f32${c < nCols - 1 ? ', ' : ''}`;
        }
        str += `]${r < nRows - 1 ? ',\n' : '\n'}`;
      }
      str += '    ]';
      return str;
    };

    return `//! Experimental no_std controller module example
//! Allocation behavior, execution timing, and safety have not been qualified.

#![no_std]
#![forbid(unsafe_code)]

pub const STATE_DIM: usize = ${n};
pub const INPUT_DIM: usize = ${m};
pub const OUTPUT_DIM: usize = ${p};
pub const SAMPLE_DT: f32 = ${dt.toFixed(6)}_f32;

const K_GAIN: [[f32; STATE_DIM]; INPUT_DIM] = ${formatMatrixRust(K, m, n)};
const A_MAT: [[f32; STATE_DIM]; STATE_DIM] = ${formatMatrixRust(A, n, n)};
const B_MAT: [[f32; INPUT_DIM]; STATE_DIM] = ${formatMatrixRust(B, n, m)};

#[derive(Debug, Clone, Copy, Default)]
pub struct ControllerInputs {
    pub reference: [f32; OUTPUT_DIM],
    pub measurement: [f32; STATE_DIM],
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ControllerOutputs {
    pub control_effort: [f32; INPUT_DIM],
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ControllerState {
    pub x: [f32; STATE_DIM],
    pub step_counter: u32,
}

impl ControllerState {
    pub const fn new() -> Self {
        Self {
            x: [0.0_f32; STATE_DIM],
            step_counter: 0,
        }
    }

    #[inline]
    pub fn step(&mut self, inputs: &ControllerInputs) -> ControllerOutputs {
        let mut u_ctrl = [0.0_f32; INPUT_DIM];
        let mut x_next = [0.0_f32; STATE_DIM];

        // 1. Calculate control effort
        for i in 0..INPUT_DIM {
            let mut sum = 0.0_f32;
            for j in 0..STATE_DIM {
                let err = if j < OUTPUT_DIM {
                    inputs.reference[j] - inputs.measurement[j]
                } else {
                    -inputs.measurement[j]
                };
                sum += K_GAIN[i][j] * err;
            }
            // Clamp control effort within [-100, 100]
            u_ctrl[i] = sum.clamp(-100.0_f32, 100.0_f32);
        }

        // 2. Observer update: x_next = A * x + B * u
        for i in 0..STATE_DIM {
            let mut ax_sum = 0.0_f32;
            for j in 0..STATE_DIM {
                ax_sum += A_MAT[i][j] * self.x[j];
            }
            let mut bu_sum = 0.0_f32;
            for j in 0..INPUT_DIM {
                bu_sum += B_MAT[i][j] * u_ctrl[j];
            }
            x_next[i] = ax_sum + bu_sum;
        }

        self.x = x_next;
        self.step_counter = self.step_counter.wrapping_add(1);

        ControllerOutputs {
            control_effort: u_ctrl,
        }
    }
}
`;
  }
}

module.exports = { AutocoderCRust };
