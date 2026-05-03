module pprf::pprf;

use std::string;
use sui::coin;
use sui::coin_registry::{Self, CoinRegistry, Currency, MetadataCap};
use sui::transfer::Receiving;

const DECIMALS: u8 = 9;
const TOTAL_SUPPLY_BASE_UNITS: u64 = 10_000_000_000_000_000_000;

const SYMBOL: vector<u8> = b"PPRF";
const NAME: vector<u8> = b"PPRF Token";
const DESCRIPTION: vector<u8> = b"PaperProof Protocol Token (PPRF) is the governance and treasury token of PaperProof, a decentralized protocol on Sui for publishing, verifying, distributing, and engaging with digital artifacts. PPRF supports protocol governance, treasury stewardship, ecosystem growth, and long-term sustainability. PaperProof combines on-chain records with decentralized storage to enable verifiable content and global community participation around published artifacts.";
const ICON_URL: vector<u8> = b"https://aggregator.walrus-mainnet.walrus.space/v1/blobs/46egR1yyhHVRNdNx72ICBQ99AiywUaMwfi00CDYznUI";

/// One-time witness for the PPRF currency type.
public struct PPRF has drop {}

/// Holds only the metadata capability for PPRF.
///
/// Security model:
/// - This object does NOT hold mint authority.
/// - Total supply is fixed during initialization and cannot be increased later.
/// - The remaining privileged action is metadata management through this module,
///   currently limited to updating the token icon URL.
///
/// This intentionally keeps a low-impact display-layer permission while removing
/// the higher-risk economic permission to mint additional supply.
public struct MetadataLock has key, store {
    id: object::UID,
    metadata_cap: MetadataCap<PPRF>,
}

fun init(witness: PPRF, ctx: &mut TxContext) {
    let (mut initializer, mut treasury_cap) = coin_registry::new_currency_with_otw(
        witness,
        DECIMALS,
        SYMBOL.to_string(),
        NAME.to_string(),
        DESCRIPTION.to_string(),
        string::utf8(ICON_URL),
        ctx,
    );

    // Mint the entire supply exactly once at initialization.
    let initial_supply = coin::mint(&mut treasury_cap, TOTAL_SUPPLY_BASE_UNITS, ctx);

    // Permanently remove mint authority by converting the treasury capability
    // into a fixed-supply state before finalization.
    initializer.make_supply_fixed(treasury_cap);

    // Finalize currency registration while preserving only the metadata cap.
    // This keeps icon metadata updateable, but no object with mint authority
    // survives after initialization.
    let metadata_cap = coin_registry::finalize(initializer, ctx);
    let metadata_lock = MetadataLock {
        id: object::new(ctx),
        metadata_cap,
    };

    transfer::public_transfer(initial_supply, tx_context::sender(ctx));
    transfer::public_transfer(metadata_lock, tx_context::sender(ctx));
}

/// Returns the display decimals for PPRF.
public fun decimals(): u8 {
    DECIMALS
}

/// Returns the hard-capped total supply in base units.
public fun total_supply_base_units(): u64 {
    TOTAL_SUPPLY_BASE_UNITS
}

/// Returns the hard-capped total supply in whole-token units.
public fun total_supply_tokens(): u64 {
    10_000_000_000
}

/// Update the token icon URL after the logo has been hosted publicly.
///
/// Security note:
/// - This function can change only the display-layer icon URL.
/// - It cannot alter supply, decimals, symbol, or name.
/// - The caller must hold `MetadataLock`, which carries metadata authority only.
/// - If a project later wants the icon to become effectively immutable in practice,
///   `MetadataLock` may be transferred to an unrecoverable sink or black-hole address.
///
/// Keeping this function is a deliberate usability choice and does not reintroduce
/// the mint-authority risk removed during initialization.
public fun update_icon_url(
    admin: &MetadataLock,
    currency: &mut Currency<PPRF>,
    icon_url: vector<u8>,
) {
    coin_registry::set_icon_url(currency, &admin.metadata_cap, string::utf8(icon_url));
}

/// Complete the OTW currency registration by promoting the temporary
/// `Currency<PPRF>` object held by `CoinRegistry` into its final shared form.
///
/// Why this exists:
/// - `new_currency_with_otw` is intentionally a two-step flow in Sui.
/// - Package publish runs `init`, which can create and transfer the temporary
///   currency object, but `init` cannot also borrow the shared `CoinRegistry`
///   object and the `Receiving<Currency<PPRF>>` ticket required to finalize
///   registration in the same publish call.
/// - This entry function provides the second step explicitly, so operators can
///   complete setup with a dedicated transaction immediately after publish.
public fun finalize_registration(
    registry: &mut CoinRegistry,
    currency: Receiving<Currency<PPRF>>,
    ctx: &mut TxContext,
) {
    coin_registry::finalize_registration(registry, currency, ctx);
}

#[test_only]
/// Test-only helper that runs the same initialization path as package publish.
/// This keeps scenario tests aligned with production initialization behavior
/// without exposing any extra runtime capability in non-test builds.
public(package) fun init_for_testing(ctx: &mut TxContext) {
    init(PPRF {}, ctx);
}
