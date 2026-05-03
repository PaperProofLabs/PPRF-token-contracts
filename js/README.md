# PPRF Token Scripts

Use of the source code in this folder is governed by the repository root [LICENSE](../LICENSE). Public availability does not grant rights to copy, modify, distribute, redeploy, commercialize, or patent-license this code except as expressly permitted there.

This folder contains two standalone Node.js scripts for the `PPRF-token` package:

1. `finalize_registration.mjs`
   - completes the second step of the `coin_registry::new_currency_with_otw` flow,
   - promotes the temporary `Currency<PPRF>` object into its final shared form.

2. `set_pprf_logo.mjs`
   - uploads logo bytes to Walrus,
   - builds the Walrus blob download URL,
   - updates `Currency<PPRF>.icon_url` through `pprf::update_icon_url`.

The scripts automatically read `Published.toml` to resolve `PPRF_PACKAGE_ID` when it is not set explicitly.

## Setup

Install dependencies:

```powershell
cd PaperProofLabs\PPRF-token\js
npm install
```

Populate `.env` with at least:

- `SUI_PRIVATE_KEY`

Optional values:

- `PPRF_PACKAGE_ID`
- `PPRF_COIN_REGISTRY_ID`
- `PPRF_PUBLISH_DIGEST`
- `PPRF_PENDING_CURRENCY_OBJECT_ID`
- `PPRF_CURRENCY_OBJECT_ID`
- `PPRF_METADATA_LOCK_ID`
- `PPRF_LOGO_PATH`

## Step 1: Finalize Currency Registration

After `sui client publish ...`, run:

```powershell
cd PaperProofLabs\PPRF-token\js
node .\finalize_registration.mjs
```

Behavior:

- defaults `CoinRegistry` to `0xc`
- prefers an explicit `PPRF_PENDING_CURRENCY_OBJECT_ID` when provided
- otherwise discovers the package publish transaction from the current package object
- then extracts the temporary `Currency<PPRF>` object created for `CoinRegistry`
- calls `package::pprf::finalize_registration`
- prints the final `Currency<PPRF>` object ID

After success, save the printed value as:

```text
PPRF_CURRENCY_OBJECT_ID=0x...
```

## Step 2: Update the Logo

Once registration is finalized and `PPRF_CURRENCY_OBJECT_ID` is known:

```powershell
cd PaperProofLabs\PPRF-token\js
node .\set_pprf_logo.mjs
```

Behavior:

- uploads the local logo image to Walrus
- waits for Walrus registration / certification
- discovers the signer-owned `MetadataLock` automatically unless `PPRF_METADATA_LOCK_ID` is set
- calls `package::pprf::update_icon_url`
- reads the resulting `iconUrl` back via RPC coin metadata

## Notes

- `set_pprf_logo.mjs` only updates the logo. It does not finalize registration.
- `finalize_registration.mjs` only finalizes registration. It does not upload or change the logo.
- Default logo path is `..\docs\logo.png`.
- Default Walrus duration is `53` epochs, about two years.
- Explorer display can still lag behind on-chain metadata updates because each explorer refreshes token metadata on its own schedule.
