/**
 * Compatibility surface for the withdrawn hardware-token example.
 *
 * No PKCS#11 provider, hardware token, key store, or validated cryptographic
 * module is bundled. Signing and token operations therefore fail closed.
 */

'use strict';

const CKR = {
  CKR_OK: 0x00000000,
  CKR_CRYPTOKI_NOT_INITIALIZED: 0x00000190,
  CKR_CRYPTOKI_ALREADY_INITIALIZED: 0x00000191,
  CKR_SLOT_ID_INVALID: 0x00000003,
  CKR_TOKEN_NOT_PRESENT: 0x000000e0,
  CKR_PIN_INCORRECT: 0x000000a0,
  CKR_PIN_LOCKED: 0x000000a4,
  CKR_SESSION_HANDLE_INVALID: 0x000000b3,
  CKR_USER_NOT_LOGGED_IN: 0x00000101,
  CKR_SIGNATURE_INVALID: 0x000000c0,
  CKR_FUNCTION_NOT_SUPPORTED: 0x00000054
};

const CKU = {
  CKU_SO: 0,
  CKU_USER: 1
};

class PKCS11HardwareToken {
  constructor() {
    this.validationLevel = 'experimental';
    this.status = 'unavailable';
  }

  _unavailable(operation) {
    return {
      rv: CKR.CKR_FUNCTION_NOT_SUPPORTED,
      success: false,
      status: 'unavailable',
      validationLevel: this.validationLevel,
      operation,
      error: 'No hardware signing provider is configured.'
    };
  }

  C_Initialize() { return CKR.CKR_FUNCTION_NOT_SUPPORTED; }
  C_Finalize() { return CKR.CKR_FUNCTION_NOT_SUPPORTED; }
  C_GetSlotList() { return { ...this._unavailable('C_GetSlotList'), slots: [] }; }
  C_GetTokenInfo() { return this._unavailable('C_GetTokenInfo'); }
  C_OpenSession() { return this._unavailable('C_OpenSession'); }
  C_CloseSession() { return CKR.CKR_FUNCTION_NOT_SUPPORTED; }
  C_Login() { return CKR.CKR_FUNCTION_NOT_SUPPORTED; }
  C_Logout() { return CKR.CKR_FUNCTION_NOT_SUPPORTED; }
  C_SignInit() { return CKR.CKR_FUNCTION_NOT_SUPPORTED; }
  C_Sign() { return this._unavailable('C_Sign'); }
  C_Verify() { return { ...this._unavailable('C_Verify'), valid: false }; }

  signEngineeringArtifact() {
    return this._unavailable('signEngineeringArtifact');
  }
}

module.exports = { PKCS11HardwareToken, CKR, CKU };
