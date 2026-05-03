import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { walrus } from "@mysten/walrus";

import {
  coinType,
  createKeypair,
  env,
  findOwnedObjectIdByType,
  loadDotEnv,
  metadataLockType,
  requiredEnv,
  resolvePackageId,
} from "./common.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_LOGO_PATH = path.resolve(PACKAGE_ROOT, "docs/logo.png");

await loadDotEnv(path.resolve(__dirname, ".env"));

const config = {
  suiNetwork: env("SUI_NETWORK", "mainnet"),
  suiRpcUrl: env("SUI_RPC_URL", "https://fullnode.mainnet.sui.io:443"),
  walrusWasmUrl: env(
    "WALRUS_WASM_URL",
    "https://unpkg.com/@mysten/walrus-wasm@latest/web/walrus_wasm_bg.wasm",
  ),
  walrusUploadRelayUrl: env(
    "WALRUS_UPLOAD_RELAY_URL",
    "https://upload-relay.mainnet.walrus.space",
  ),
  walrusDownloadBaseUrl: env(
    "WALRUS_DOWNLOAD_BASE_URL",
    "https://aggregator.walrus-mainnet.walrus.space",
  ),
  walrusDefaultEpochs: Number(env("WALRUS_EPOCHS", "53")),
  walrusDeletable: env("WALRUS_DELETABLE", "false").toLowerCase() === "true",
  walrusUploadRelayTipMaxMist: Number(env("WALRUS_UPLOAD_RELAY_TIP_MAX_MIST", "3000000")),
  explicitPackageId: env("PPRF_PACKAGE_ID", ""),
  metadataLockId: env("PPRF_METADATA_LOCK_ID", ""),
  currencyObjectId: env("PPRF_CURRENCY_OBJECT_ID", ""),
  logoPath: env("PPRF_LOGO_PATH", DEFAULT_LOGO_PATH),
};

async function main() {
  const packageId = await resolvePackageId({
    packageRoot: PACKAGE_ROOT,
    network: config.suiNetwork,
    explicitPackageId: config.explicitPackageId,
  });
  const signer = createKeypair(requiredEnv("SUI_PRIVATE_KEY"));
  const signerAddress = signer.toSuiAddress();
  const suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl });
  const walrusClient = new SuiGrpcClient({
    network: config.suiNetwork,
    baseUrl: config.suiRpcUrl,
  }).$extend(
    walrus({
      wasmUrl: config.walrusWasmUrl,
      uploadRelay: {
        host: config.walrusUploadRelayUrl,
        sendTip: {
          max: config.walrusUploadRelayTipMaxMist,
        },
      },
    }),
  );

  const currentCurrencyObjectId = requiredValue(
    config.currencyObjectId,
    "PPRF_CURRENCY_OBJECT_ID",
    "Run finalize_registration first, then set PPRF_CURRENCY_OBJECT_ID to the shared Currency<PPRF> object ID.",
  );

  console.log(`Package: ${packageId}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Logo path: ${config.logoPath}`);

  const logoBytes = new Uint8Array(await fs.readFile(config.logoPath));
  const flow = walrusClient.walrus.writeBlobFlow({ blob: logoBytes });
  const encoded = await flow.encode();
  const blobId = encoded?.blobId || encoded?.blob_id;

  if (!blobId) {
    throw new Error("Walrus flow did not return a blob ID.");
  }

  console.log(`Walrus blob ID: ${blobId}`);

  const registerResult = await flow.executeRegister({
    signer,
    client: suiClient,
    epochs: config.walrusDefaultEpochs,
    owner: signerAddress,
    deletable: config.walrusDeletable,
  });
  const registerDigest = extractDigest(registerResult);
  console.log(`Walrus register digest: ${registerDigest}`);
  await suiClient.waitForTransaction({ digest: registerDigest });

  const uploadResult = await flow.upload({ digest: registerDigest });
  const uploadedBlobObjectId =
    uploadResult?.blobObject?.id ||
    uploadResult?.blobObjectId ||
    uploadResult?.blob_object_id ||
    "";
  if (uploadedBlobObjectId) {
    console.log(`Walrus blob object ID: ${uploadedBlobObjectId}`);
  }

  const iconUrl = `${config.walrusDownloadBaseUrl}/v1/blobs/${blobId}`;
  const certifyDigest = await certifyBlobWithFallback({
    flow,
    signer,
    suiClient,
    iconUrl,
  });
  if (certifyDigest) {
    console.log(`Walrus certify digest: ${certifyDigest}`);
    await suiClient.waitForTransaction({ digest: certifyDigest });
  } else {
    console.log("Walrus certify digest: (not returned)");
  }
  console.log(`icon_url: ${iconUrl}`);

  const currentMetadataLockId =
    config.metadataLockId ||
    (await findOwnedObjectIdByType(suiClient, signerAddress, metadataLockType(packageId)));

  if (!currentMetadataLockId) {
    throw new Error(
      `Could not find owned MetadataLock object of type ${metadataLockType(packageId)}.`,
    );
  }

  console.log(`MetadataLock: ${currentMetadataLockId}`);
  console.log(`Currency<PPRF>: ${currentCurrencyObjectId}`);

  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::pprf::update_icon_url`,
    arguments: [
      tx.object(currentMetadataLockId),
      tx.object(currentCurrencyObjectId),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(iconUrl))),
    ],
  });
  tx.setGasBudget(20_000_000);

  const metadataResult = await suiClient.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
    },
  });

  const metadataDigest = extractDigest(metadataResult);
  if (!metadataDigest) {
    throw new Error("Logo update transaction did not return a digest.");
  }
  console.log(`Logo update digest: ${metadataDigest}`);

  await suiClient.waitForTransaction({ digest: metadataDigest });

  const metadata = await suiClient.getCoinMetadata({
    coinType: coinType(packageId),
  });

  console.log("");
  console.log("Done.");
  console.log(`Final icon_url: ${iconUrl}`);
  console.log(`On-chain icon_url: ${metadata?.coinMetadata?.iconUrl || "(not returned by RPC)"}`);
}

function requiredValue(value, name, hint) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. ${hint}`);
  }
  return value;
}

function extractDigest(result) {
  return (
    result?.txDigest ||
    result?.digest ||
    result?.Transaction?.digest ||
    result?.transaction?.digest ||
    ""
  );
}

async function certifyBlobWithFallback({ flow, signer, suiClient, iconUrl }) {
  try {
    const certifyResult = await flow.executeCertify({
      signer,
      client: suiClient,
    });
    return extractDigest(certifyResult);
  } catch (error) {
    const message = error?.message || String(error);
    if (!/timeout/i.test(message)) {
      throw error;
    }

    console.warn("Walrus certify timed out. Checking blob availability before continuing...");
    const available = await waitForBlobAvailability(iconUrl, 12, 5000);
    if (!available) {
      throw new Error(
        `Walrus certify timed out and blob is still not readable at ${iconUrl}. Please rerun the script in a few minutes.`,
      );
    }

    console.warn("Blob is already readable from the aggregator. Continuing to update icon_url.");
    return "";
  }
}

async function waitForBlobAvailability(url, attempts, delayMs) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Retry below.
    }

    if (i < attempts - 1) {
      await sleep(delayMs);
    }
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("");
  console.error("Failed to update the PPRF logo.");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
