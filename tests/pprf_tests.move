// Copyright (c) 2026 PaperProof Labs. All rights reserved.
// SPDX-License-Identifier: LicenseRef-PaperProof-Source-Available
// Use of this source code is governed by the LICENSE file in the project root.
// Public readability and auditability do not grant rights to copy, modify,
// distribute, redeploy, or commercialize this code except as expressly permitted.

#[test_only]
module pprf::pprf_tests;

use std::string;
use std::unit_test::assert_eq;
use pprf::pprf::{Self, MetadataLock, PPRF};
use sui::coin::{Self, Coin, TreasuryCap};
use sui::coin_registry::{Self, Currency};
use sui::test_scenario;

const EXPECTED_ICON_URL: vector<u8> =
    b"https://aggregator.walrus-mainnet.walrus.space/v1/blobs/46egR1yyhHVRNdNx72ICBQ99AiywUaMwfi00CDYznUI";
const UPDATED_ICON_URL: vector<u8> = b"https://example.com/pprf-updated-icon.png";
const REGISTRY_ADDRESS: address = @0xc;
const PUBLISHER: address = @0xA11CE;

#[test]
fun test_supply_constants() {
    assert!(pprf::decimals() == 9, 0);
    assert!(pprf::total_supply_tokens() == 10_000_000_000, 1);
    assert!(pprf::total_supply_base_units() == 10_000_000_000_000_000_000, 2);
}

#[test]
fun test_supply_unit_conversion() {
    let decimals = pprf::decimals();
    let whole_tokens = pprf::total_supply_tokens();
    let base_units = pprf::total_supply_base_units();
    let scale = 1_000_000_000;

    assert!(decimals == 9, 10);
    assert!(whole_tokens * scale == base_units, 11);
}

#[test]
fun test_init_distributes_supply_and_metadata_lock() {
    let mut scenario = test_scenario::begin(PUBLISHER);
    pprf::init_for_testing(test_scenario::ctx(&mut scenario));

    test_scenario::next_tx(&mut scenario, PUBLISHER);

    assert!(test_scenario::has_most_recent_for_sender<Coin<PPRF>>(&scenario), 20);
    assert!(test_scenario::has_most_recent_for_sender<MetadataLock>(&scenario), 21);
    assert!(test_scenario::has_most_recent_for_address<Currency<PPRF>>(REGISTRY_ADDRESS), 22);
    assert!(!test_scenario::has_most_recent_for_sender<TreasuryCap<PPRF>>(&scenario), 23);

    let supply_coin = test_scenario::take_from_sender<Coin<PPRF>>(&scenario);
    assert!(coin::value(&supply_coin) == pprf::total_supply_base_units(), 24);

    let metadata_lock = test_scenario::take_from_sender<MetadataLock>(&scenario);

    test_scenario::return_to_sender(&scenario, supply_coin);
    test_scenario::return_to_sender(&scenario, metadata_lock);
    test_scenario::end(scenario);
}

#[test]
fun test_currency_is_fixed_supply_after_init() {
    let mut scenario = test_scenario::begin(PUBLISHER);
    pprf::init_for_testing(test_scenario::ctx(&mut scenario));

    test_scenario::next_tx(&mut scenario, PUBLISHER);

    let currency = test_scenario::take_from_address<Currency<PPRF>>(&scenario, REGISTRY_ADDRESS);

    assert!(coin_registry::is_supply_fixed(&currency), 30);
    assert!(!coin_registry::is_supply_burn_only(&currency), 31);
    assert!(
        coin_registry::total_supply(&currency).is_some_and!(
            |total| total == pprf::total_supply_base_units()
        ),
        32,
    );
    assert!(coin_registry::is_metadata_cap_claimed(&currency), 33);
    assert!(!coin_registry::is_metadata_cap_deleted(&currency), 34);
    assert_eq!(coin_registry::icon_url(&currency), string::utf8(EXPECTED_ICON_URL));

    test_scenario::return_to_address(REGISTRY_ADDRESS, currency);
    test_scenario::end(scenario);
}

#[test]
fun test_update_icon_url_changes_only_icon_metadata() {
    let mut scenario = test_scenario::begin(PUBLISHER);
    pprf::init_for_testing(test_scenario::ctx(&mut scenario));

    test_scenario::next_tx(&mut scenario, PUBLISHER);

    let metadata_lock = test_scenario::take_from_sender<MetadataLock>(&scenario);
    let mut currency = test_scenario::take_from_address<Currency<PPRF>>(&scenario, REGISTRY_ADDRESS);

    let original_name = coin_registry::name(&currency);
    let original_symbol = coin_registry::symbol(&currency);
    let original_description = coin_registry::description(&currency);

    pprf::update_icon_url(&metadata_lock, &mut currency, UPDATED_ICON_URL);

    assert_eq!(coin_registry::icon_url(&currency), string::utf8(UPDATED_ICON_URL));
    assert_eq!(coin_registry::name(&currency), original_name);
    assert_eq!(coin_registry::symbol(&currency), original_symbol);
    assert_eq!(coin_registry::description(&currency), original_description);
    assert!(coin_registry::is_supply_fixed(&currency), 40);
    assert!(
        coin_registry::total_supply(&currency).is_some_and!(
            |total| total == pprf::total_supply_base_units()
        ),
        41,
    );

    test_scenario::return_to_address(REGISTRY_ADDRESS, currency);
    test_scenario::return_to_sender(&scenario, metadata_lock);
    test_scenario::end(scenario);
}
