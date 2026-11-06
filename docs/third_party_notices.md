# Third-Party Notices and Review Status

The dependency inventory is generated from the lockfile and installed package metadata. See `docs/sbom/omnieng-dependencies.cdx.json` (CycloneDX) and `docs/sbom/omnieng-dependencies.spdx.json` (SPDX) for the current component list.

Direct dependencies declared in `package.json` and their lockfile-resolved SBOM versions are:

- `three@0.186.1` — runtime dependency; SBOM declares MIT.
- `electron@45.1.0` — development/runtime packaging dependency; SBOM declares MIT.
- `electron-builder@26.15.3` — development packaging dependency; SBOM declares MIT.
- `eslint@9.39.5` — development tooling; SBOM declares MIT.
- `globals@17.13.0` — development tooling; SBOM declares MIT.
- `prettier@3.9.10` — development tooling; SBOM declares MIT.
- `typescript@7.0.2` — development tooling; SBOM declares Apache-2.0.

These are the declared identifiers recorded in the generated SBOM, not a legal review of the packages or their bundled runtime components. The SBOM also contains transitive dependencies and is the authoritative versioned component list for this lockfile.

This inventory does not substitute for manual license review. License texts, attribution duties, patent terms, data redistribution rights, and bundled runtime behavior have not all been reviewed. `package.json` declares ISC for the application; no root `LICENSE` text is currently present. The application license/EULA decision remains unresolved with the rights holder. The optical and plant data provenance limitations are recorded in `docs/data_provenance.md`.

The bundled NASA TMR Kármán–Schoenherr reference table is from the TMBWG [`turbmodels` repository](https://github.com/TMBWG/turbmodels), which declares [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/). Source location, checksum, and its theoretical-only role are recorded in `docs/data_provenance.md`.

The experimental Timoshenko beam reference fixture transcribes numerical inputs and a reported MOOSE finite-element result from the [MOOSE beam V&V page](https://mooseframework.inl.gov/releases/moose/2022-06-10/modules/tensor_mechanics/beam_vandv.html). It includes no MOOSE code or copied output file; the fixture's source and checksum are recorded in `docs/data_provenance.md`. Rights to redistribute the source documentation/data have not been independently reviewed, and this case is not released validation evidence.

Regenerate both SBOMs after changing `package.json` or `package-lock.json` with `npm run sbom`. The generator records the lockfile hash and generation timestamp alongside the SBOMs.
