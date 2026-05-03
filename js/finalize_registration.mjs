// Copyright (c) 2026 PaperProof Labs. All rights reserved.
// SPDX-License-Identifier: LicenseRef-PaperProof-Source-Available
// Use of this source code is governed by the LICENSE file in the project root.
// Public readability and auditability do not grant rights to copy, modify,
// distribute, redeploy, or commercialize this code except as expressly permitted.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import {
  createKeypair,
  currencyType,
  env,
  loadDotEnv,
  requiredEnv,
  resolvePackageId,
} from "./common.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");

await loadDotEnv(path.resolve(__dirname, ".env"));

const config = {
  suiNetwork: env("SUI_NETWORK", "mainnet"),
  suiRpcUrl: env("SUI_RPC_URL", "https://fullnode.mainnet.sui.io:443"),
  explicitPackageId: env("PPRF_PACKAGE_ID", ""),
  registryObjectId: env("PPRF_COIN_REGISTRY_ID", "0xc"),
  pendingCurrencyObjectId: env("PPRF_PENDING_CURRENCY_OBJECT_ID", ""),
  publishDigest: env("PPRF_PUBLISH_DIGEST", ""),
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
  const registryId = config.registryObjectId;

  const pendingCurrencyId =
    config.pendingCurrencyObjectId ||
    (await discoverPendingCurrencyObjectId({
      client: suiClient,
      packageId,
      registryId,
      publishDigest: config.publishDigest,
    }));

  if (!pendingCurrencyId) {
    throw new Error(
      `Could not find the pending Currency<PPRF> object. Set PPRF_PENDING_CURRENCY_OBJECT_ID explicitly if auto-discovery cannot determine it.`,
    );
  }

  console.log(`Package: ${packageId}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`CoinRegistry: ${registryId}`);
  if (config.publishDigest) {
    console.log(`Publish digest: ${config.publishDigest}`);
  }
  console.log(`Pending Currency<PPRF>: ${pendingCurrencyId}`);

  const pendingObject = await safeGetObject(suiClient, pendingCurrencyId);
  if (!pendingObject?.data) {
    throw new Error(
      `Pending Currency<PPRF> object ${pendingCurrencyId} no longer exists. This publish has likely already been finalized, or PPRF_PENDING_CURRENCY_OBJECT_ID points to an old temporary object.`,
    );
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::pprf::finalize_registration`,
    arguments: [tx.object(registryId), tx.object(pendingCurrencyId)],
  });
  tx.setGasBudget(20_000_000);

  const result = await suiClient.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showObjectChanges: true,
    },
  });

  const digest = extractDigest(result);
  if (!digest) {
    throw new Error("Finalize registration transaction did not return a digest.");
  }
  console.log(`Finalize registration digest: ${digest}`);

  await suiClient.waitForTransaction({ digest });

  const currencyObject = await suiClient.getObject({
    id: pendingCurrencyId,
    options: {
      showType: true,
      showOwner: true,
    },
  });

  const owner = currencyObject?.data?.owner;
  const isShared =
    !!owner &&
    typeof owner === "object" &&
    ("Shared" in owner || owner.$kind === "Shared" || "ConsensusAddressOwner" in owner);

  console.log("");
  console.log("Done.");
  console.log(`Currency<PPRF> object ID: ${pendingCurrencyId}`);
  console.log(`Shared after finalize: ${isShared ? "yes" : "no / unable to confirm"}`);
  console.log(`Suggested env: PPRF_CURRENCY_OBJECT_ID=${pendingCurrencyId}`);
}

async function discoverPendingCurrencyObjectId({ client, packageId, registryId, publishDigest }) {
  const digest = publishDigest || (await getPackagePublishDigest(client, packageId));
  if (!digest) {
    return "";
  }

  const tx = await client.getTransactionBlock({
    digest,
    options: {
      showObjectChanges: true,
    },
  });

  const targetType = currencyType(packageId);
  const createdCurrency = tx?.objectChanges?.find((change) => {
    if (change?.type !== "created") return false;
    if (change?.objectType !== targetType) return false;
    return normalizeOwnerAddress(change?.owner) === normalizeHexAddress(registryId);
  });

  return createdCurrency?.objectId || "";
}

async function getPackagePublishDigest(client, packageId) {
  const object = await client.getObject({
    id: packageId,
    options: {
      showPreviousTransaction: true,
    },
  });

  return object?.data?.previousTransaction || "";
}

async function safeGetObject(client, objectId) {
  try {
    return await client.getObject({
      id: objectId,
      options: {
        showType: true,
        showOwner: true,
      },
    });
  } catch {
    return null;
  }
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

function normalizeOwnerAddress(owner) {
  if (!owner) return "";
  if (typeof owner === "string") return normalizeHexAddress(owner);
  if (typeof owner === "object") {
    if (typeof owner.AddressOwner === "string") return normalizeHexAddress(owner.AddressOwner);
    if (typeof owner.ObjectOwner === "string") return normalizeHexAddress(owner.ObjectOwner);
  }
  return "";
}

function normalizeHexAddress(value) {
  const lower = value.toLowerCase();
  const prefixed = lower.startsWith("0x") ? lower : `0x${lower}`;
  return normalizeSuiAddress(prefixed);
}

main().catch((error) => {
  console.error("");
  console.error("Failed to finalize PPRF registration.");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
