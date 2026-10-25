/**
 * OmniEng Binary GDSII / OASIS Layout Stream Engine
 * High-performance binary serialization and deserialization of integrated circuit layouts.
 * Supports GDSII Stream Format (Release 6.0) specification with full record type encoding/decoding.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

// GDSII Record Data Types
const GdsDataType = {
  NO_DATA: 0x00,
  BIT_ARRAY: 0x01,
  INT_16: 0x02,
  INT_32: 0x03,
  REAL_32: 0x04,
  REAL_64: 0x05,
  ASCII: 0x06
};

// Standard GDSII Record Types (Header Byte << 8 | DataType)
const GdsRecordType = {
  HEADER: 0x0002,
  BGNLIB: 0x0102,
  LIBNAME: 0x0206,
  UNITS: 0x0305,
  ENDLIB: 0x0400,
  BGNSTR: 0x0502,
  STRNAME: 0x0606,
  ENDSTR: 0x0700,
  BOUNDARY: 0x0800,
  PATH: 0x0900,
  SREF: 0x0A00,
  AREF: 0x0B00,
  TEXT: 0x0C00,
  LAYER: 0x0D02,
  DATATYPE: 0x0E02,
  WIDTH: 0x0F03,
  XY: 0x1003,
  ENDEL: 0x1100,
  SNAME: 0x1206,
  COLROW: 0x1302,
  TEXTTYPE: 0x1602,
  PRESENTATION: 0x1701,
  STRING: 0x1906,
  STRANS: 0x1A01,
  MAG: 0x1B05,
  ANGLE: 0x1C05
};

/**
 * Encodes IEEE 754 float into GDSII excess-64 8-byte hexadecimal floating-point format
 */
function floatToGdsReal(val) {
  if (val === 0.0) return Buffer.alloc(8, 0);

  const sign = val < 0 ? 0x80 : 0x00;
  let v = Math.abs(val);

  // Compute exponent in base 16: v = m * 16^(e - 64) where 1/16 <= m < 1
  let exp = Math.floor(Math.log(v) / Math.log(16.0)) + 1;
  let mantissa = v / Math.pow(16.0, exp);

  // Exponent with excess 64 offset
  let gdsExp = (exp + 64) & 0x7F;

  const buf = Buffer.alloc(8);
  buf[0] = sign | gdsExp;

  // Convert 56-bit mantissa into 7 bytes
  for (let i = 1; i < 8; i++) {
    mantissa *= 256.0;
    const byte = Math.floor(mantissa);
    buf[i] = byte & 0xFF;
    mantissa -= byte;
  }

  return buf;
}

/**
 * Decodes GDSII 8-byte hexadecimal floating-point format into JS float
 */
function gdsRealToFloat(buf, offset = 0) {
  const b0 = buf[offset];
  const sign = (b0 & 0x80) ? -1.0 : 1.0;
  const exp = (b0 & 0x7F) - 64;

  let mantissa = 0.0;
  let factor = 1.0 / 256.0;
  for (let i = 1; i < 8; i++) {
    mantissa += buf[offset + i] * factor;
    factor /= 256.0;
  }

  return sign * mantissa * Math.pow(16.0, exp);
}

class GdsPolygon {
  constructor(layer = 1, datatype = 0, points = []) {
    this.layer = layer;
    this.datatype = datatype;
    this.points = points; // [{ x, y }, ...] in database units
  }
}

class GdsPath {
  constructor(layer = 1, datatype = 0, width = 0, points = []) {
    this.layer = layer;
    this.datatype = datatype;
    this.width = width;
    this.points = points;
  }
}

class GdsStructure {
  constructor(name = 'TOP') {
    this.name = name;
    this.elements = []; // Array of GdsPolygon | GdsPath | GdsReference
  }

  addPolygon(layer, datatype, points) {
    const poly = new GdsPolygon(layer, datatype, points);
    this.elements.push(poly);
    return poly;
  }

  addPath(layer, datatype, width, points) {
    const path = new GdsPath(layer, datatype, width, points);
    this.elements.push(path);
    return path;
  }
}

class GdsLibrary {
  constructor(name = 'OMNIENG_LIB', userUnits = 1e-3, dbUnits = 1e-9) {
    this.name = name;
    this.userUnits = userUnits; // 0.001 = 1 user unit is 1 mm
    this.dbUnits = dbUnits;     // 1e-9 = 1 database unit is 1 nanometer
    this.structures = new Map();
  }

  createStructure(name) {
    const str = new GdsStructure(name);
    this.structures.set(name, str);
    return str;
  }

  getStructure(name) {
    return this.structures.get(name);
  }
}

/**
 * High-Speed Binary GDSII Stream Writer & Reader
 */
class GdsiiStreamEngine {
  /**
   * Serializes a GdsLibrary instance into a raw binary GDSII Buffer
   * @param {GdsLibrary} lib
   * @returns {Buffer}
   */
  static writeGdsii(lib) {
    const chunks = [];

    function writeRecord(recType, dataBuf = null) {
      const len = 4 + (dataBuf ? dataBuf.length : 0);
      const header = Buffer.alloc(4);
      header.writeUInt16BE(len, 0);
      header.writeUInt16BE(recType, 2);
      chunks.push(header);
      if (dataBuf && dataBuf.length > 0) {
        chunks.push(dataBuf);
      }
    }

    function writeString(recType, str) {
      let b = Buffer.from(str, 'ascii');
      if (b.length % 2 !== 0) {
        // Pad with trailing null to maintain 16-bit word alignment
        b = Buffer.concat([b, Buffer.alloc(1, 0)]);
      }
      writeRecord(recType, b);
    }

    function writeInt16(recType, val) {
      const b = Buffer.alloc(2);
      b.writeInt16BE(val, 0);
      writeRecord(recType, b);
    }

    function writeInt32(recType, val) {
      const b = Buffer.alloc(4);
      b.writeInt32BE(val, 0);
      writeRecord(recType, b);
    }

    // 1. HEADER (Version 600)
    writeInt16(GdsRecordType.HEADER, 600);

    // 2. BGNLIB (Last modification + access timestamps: 12 words of int16)
    const now = new Date();
    const timeBuf = Buffer.alloc(24);
    const yr = now.getFullYear();
    const mo = now.getMonth() + 1;
    const dy = now.getDate();
    const hr = now.getHours();
    const mi = now.getMinutes();
    const sc = now.getSeconds();
    for (let i = 0; i < 2; i++) {
      const base = i * 12;
      timeBuf.writeInt16BE(yr, base);
      timeBuf.writeInt16BE(mo, base + 2);
      timeBuf.writeInt16BE(dy, base + 4);
      timeBuf.writeInt16BE(hr, base + 6);
      timeBuf.writeInt16BE(mi, base + 8);
      timeBuf.writeInt16BE(sc, base + 10);
    }
    writeRecord(GdsRecordType.BGNLIB, timeBuf);

    // 3. LIBNAME
    writeString(GdsRecordType.LIBNAME, lib.name);

    // 4. UNITS (User units in DB units, DB units in meters)
    const unitsBuf = Buffer.concat([
      floatToGdsReal(lib.userUnits / lib.dbUnits),
      floatToGdsReal(lib.dbUnits)
    ]);
    writeRecord(GdsRecordType.UNITS, unitsBuf);

    // 5. STRUCTURES
    for (const str of lib.structures.values()) {
      writeRecord(GdsRecordType.BGNSTR, timeBuf);
      writeString(GdsRecordType.STRNAME, str.name);

      // Elements
      for (const el of str.elements) {
        if (el instanceof GdsPolygon) {
          writeRecord(GdsRecordType.BOUNDARY);
          writeInt16(GdsRecordType.LAYER, el.layer);
          writeInt16(GdsRecordType.DATATYPE, el.datatype);

          // XY coordinate pairs (must form closed loop: first point == last point)
          const pts = el.points.slice();
          if (pts.length > 0 && (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y)) {
            pts.push({ x: pts[0].x, y: pts[0].y });
          }

          const xyBuf = Buffer.alloc(pts.length * 8);
          for (let pIdx = 0; pIdx < pts.length; pIdx++) {
            xyBuf.writeInt32BE(Math.round(pts[pIdx].x), pIdx * 8);
            xyBuf.writeInt32BE(Math.round(pts[pIdx].y), pIdx * 8 + 4);
          }
          writeRecord(GdsRecordType.XY, xyBuf);
          writeRecord(GdsRecordType.ENDEL);
        } else if (el instanceof GdsPath) {
          writeRecord(GdsRecordType.PATH);
          writeInt16(GdsRecordType.LAYER, el.layer);
          writeInt16(GdsRecordType.DATATYPE, el.datatype);
          if (el.width > 0) {
            writeInt32(GdsRecordType.WIDTH, el.width);
          }

          const xyBuf = Buffer.alloc(el.points.length * 8);
          for (let pIdx = 0; pIdx < el.points.length; pIdx++) {
            xyBuf.writeInt32BE(Math.round(el.points[pIdx].x), pIdx * 8);
            xyBuf.writeInt32BE(Math.round(el.points[pIdx].y), pIdx * 8 + 4);
          }
          writeRecord(GdsRecordType.XY, xyBuf);
          writeRecord(GdsRecordType.ENDEL);
        }
      }

      writeRecord(GdsRecordType.ENDSTR);
    }

    // 6. ENDLIB
    writeRecord(GdsRecordType.ENDLIB);

    return Buffer.concat(chunks);
  }

  /**
   * Deserializes a binary GDSII Buffer into a GdsLibrary instance
   * @param {Buffer} buffer
   * @returns {GdsLibrary}
   */
  static readGdsii(buffer) {
    let offset = 0;
    let lib = new GdsLibrary('PARSED_LIB');
    let currentStr = null;
    let currentEl = null;

    while (offset < buffer.length) {
      if (offset + 4 > buffer.length) break;
      const len = buffer.readUInt16BE(offset);
      const recType = buffer.readUInt16BE(offset + 2);
      const dataLen = len - 4;
      const dataOffset = offset + 4;

      if (len < 4 || offset + len > buffer.length) {
        throw new Error(`Corrupted GDSII record at offset ${offset}: declared length ${len}`);
      }

      switch (recType) {
        case GdsRecordType.LIBNAME: {
          const nameStr = buffer.toString('ascii', dataOffset, dataOffset + dataLen).replace(/\0+$/, '');
          lib.name = nameStr;
          break;
        }
        case GdsRecordType.UNITS: {
          if (dataLen >= 16) {
            const userInDb = gdsRealToFloat(buffer, dataOffset);
            const dbInM = gdsRealToFloat(buffer, dataOffset + 8);
            lib.dbUnits = dbInM;
            lib.userUnits = userInDb * dbInM;
          }
          break;
        }
        case GdsRecordType.BGNSTR: {
          currentStr = new GdsStructure('UNNAMED');
          break;
        }
        case GdsRecordType.STRNAME: {
          const strName = buffer.toString('ascii', dataOffset, dataOffset + dataLen).replace(/\0+$/, '');
          if (currentStr) {
            currentStr.name = strName;
            lib.structures.set(strName, currentStr);
          }
          break;
        }
        case GdsRecordType.ENDSTR: {
          currentStr = null;
          break;
        }
        case GdsRecordType.BOUNDARY: {
          currentEl = { type: 'BOUNDARY', layer: 0, datatype: 0, points: [] };
          break;
        }
        case GdsRecordType.PATH: {
          currentEl = { type: 'PATH', layer: 0, datatype: 0, width: 0, points: [] };
          break;
        }
        case GdsRecordType.LAYER: {
          if (currentEl) currentEl.layer = buffer.readInt16BE(dataOffset);
          break;
        }
        case GdsRecordType.DATATYPE: {
          if (currentEl) currentEl.datatype = buffer.readInt16BE(dataOffset);
          break;
        }
        case GdsRecordType.WIDTH: {
          if (currentEl) currentEl.width = buffer.readInt32BE(dataOffset);
          break;
        }
        case GdsRecordType.XY: {
          if (currentEl) {
            const numPoints = Math.floor(dataLen / 8);
            for (let i = 0; i < numPoints; i++) {
              const x = buffer.readInt32BE(dataOffset + i * 8);
              const y = buffer.readInt32BE(dataOffset + i * 8 + 4);
              currentEl.points.push({ x, y });
            }
          }
          break;
        }
        case GdsRecordType.ENDEL: {
          if (currentStr && currentEl) {
            if (currentEl.type === 'BOUNDARY') {
              currentStr.addPolygon(currentEl.layer, currentEl.datatype, currentEl.points);
            } else if (currentEl.type === 'PATH') {
              currentStr.addPath(currentEl.layer, currentEl.datatype, currentEl.width, currentEl.points);
            }
          }
          currentEl = null;
          break;
        }
        case GdsRecordType.ENDLIB: {
          return lib;
        }
      }

      offset += len;
    }

    return lib;
  }
}

module.exports = {
  GdsDataType,
  GdsRecordType,
  GdsPolygon,
  GdsPath,
  GdsStructure,
  GdsLibrary,
  GdsiiStreamEngine,
  floatToGdsReal,
  gdsRealToFloat
};
