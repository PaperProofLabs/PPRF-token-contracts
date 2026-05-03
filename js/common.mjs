// Copyright (c) 2026 PaperProof Labs. All rights reserved.
// SPDX-License-Identifier: LicenseRef-PaperProof-Source-Available
// Use of this source code is governed by the LICENSE file in the project root.
// Public readability and auditability do not grant rights to copy, modify,
// distribute, redeploy, or commercialize this code except as expressly permitted.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";

export function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export function requiredEnv(name) {
  const value = env(name, "");
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function coinType(packageId) {
  return `${packageId}::pprf::PPRF`;
}

export function metadataLockType(packageId) {
  return `${packageId}::pprf::MetadataLock`;
}

export function currencyType(packageId) {
  return `0x2::coin_registry::Currency<${coinType(packageId)}>`;
}

export function createKeypair(encodedPrivateKey) {
  const { scheme, secretKey } = decodeSuiPrivateKey(encodedPrivateKey);

  switch (scheme) {
    case "ED25519":
      return Ed25519Keypair.fromSecretKey(secretKey);
    case "Secp256k1":
      return Secp256k1Keypair.fromSecretKey(secretKey);
    case "Secp256r1":
      return Secp256r1Keypair.fromSecretKey(secretKey);
    default:
      throw new Error(`Unsupported key scheme: ${scheme}`);
  }
}

export async function loadDotEnv(envPath) {
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function loadPublishedPackageId({ publishedTomlPath, network }) {
  const raw = await fs.readFile(publishedTomlPath, "utf8");
  const sectionPattern = new RegExp(
    `\\[published\\.${escapeRegExp(network)}\\]([\\s\\S]*?)(?=\\n\\[|$)`,
    "m",
  );
  const sectionMatch = raw.match(sectionPattern);

  if (!sectionMatch) {
    throw new Error(
      `Could not find [published.${network}] in ${publishedTomlPath}. Set PPRF_PACKAGE_ID explicitly if needed.`,
    );
  }

  const packageIdMatch = sectionMatch[1].match(/published-at\s*=\s*"([^"]+)"/);
  if (!packageIdMatch?.[1]) {
    throw new Error(
      `Could not read published-at from [published.${network}] in ${publishedTomlPath}.`,
    );
  }

  return packageIdMatch[1];
}

export async function resolvePackageId({ packageRoot, network, explicitPackageId }) {
  try {
    return await loadPublishedPackageId({
      publishedTomlPath: path.resolve(packageRoot, "Published.toml"),
      network,
    });
  } catch (error) {
    if (explicitPackageId) {
      return explicitPackageId;
    }

    throw error;
  }
}

export async function findOwnedObjectIdByType(client, owner, structType) {
  let cursor = null;

  while (true) {
    const page = await client.getOwnedObjects({
      owner,
      filter: {
        StructType: structType,
      },
      options: {
        showType: true,
      },
      cursor,
      limit: 50,
    });

    const match = page.data?.[0]?.data?.objectId;
    if (match) {
      return match;
    }

    if (!page.hasNextPage) {
      return "";
    }

    cursor = page.nextCursor;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
