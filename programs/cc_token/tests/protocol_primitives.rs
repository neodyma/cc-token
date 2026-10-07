use std::{str::FromStr, sync::OnceLock};

use anchor_lang::prelude::Pubkey;
use cc_token::{
    constants::ROOT_COLLECTION_ID,
    identity::{derive_collection_id, derive_position_id},
    math::{calculate_payout, validate_partition, IndexSet},
    state::Condition,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConditionFixture {
    resolver: String,
    question_id: String,
    outcome_count: u16,
    condition_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectionFixture {
    condition_id: String,
    index_set_words: [String; 4],
    collection_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PositionFixture {
    collateral_mint: String,
    collection_id: String,
    position_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartitionFixture {
    name: String,
    outcome_count: u16,
    subsets: Vec<[String; 4]>,
    union: [String; 4],
    is_full: bool,
}

#[derive(Deserialize)]
struct PayoutFixture {
    name: String,
    amount: String,
    numerator: String,
    denominator: String,
    payout: String,
}

#[derive(Deserialize)]
struct Fixtures {
    condition: ConditionFixture,
    collection: CollectionFixture,
    position: PositionFixture,
    partitions: Vec<PartitionFixture>,
    payouts: Vec<PayoutFixture>,
}

#[test]
fn rust_partitions_match_shared_fixtures() {
    for fixture in &fixtures().partitions {
        let partition = fixture
            .subsets
            .iter()
            .map(|words| IndexSet {
                words: words.each_ref().map(|word| word.parse().unwrap()),
            })
            .collect::<Vec<_>>();
        let actual = validate_partition(fixture.outcome_count, &partition).unwrap();
        assert_eq!(
            actual.union.words,
            fixture
                .union
                .each_ref()
                .map(|word| word.parse::<u64>().unwrap()),
            "{}",
            fixture.name
        );
        assert_eq!(actual.is_full, fixture.is_full, "{}", fixture.name);
    }
}

fn fixtures() -> &'static Fixtures {
    static FIXTURES: OnceLock<Fixtures> = OnceLock::new();
    FIXTURES.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/protocol_primitives.json"
        ))
        .unwrap()
    })
}

#[test]
fn rust_identity_matches_shared_fixtures() {
    let fixtures = fixtures();
    let condition = &fixtures.condition;
    assert_eq!(
        Condition::derive_id(
            &Pubkey::from_str(&condition.resolver).unwrap(),
            &hex(&condition.question_id),
            condition.outcome_count,
        ),
        hex(&condition.condition_id)
    );

    let collection = &fixtures.collection;
    let index_set = IndexSet {
        words: collection
            .index_set_words
            .each_ref()
            .map(|word| word.parse().unwrap()),
    };
    assert_eq!(
        derive_collection_id(ROOT_COLLECTION_ID, hex(&collection.condition_id), index_set)
            .unwrap()
            .collection_id,
        hex(&collection.collection_id)
    );

    let position = &fixtures.position;
    assert_eq!(
        derive_position_id(
            &Pubkey::from_str(&position.collateral_mint).unwrap(),
            hex(&position.collection_id),
        )
        .unwrap(),
        hex(&position.position_id)
    );
}

#[test]
fn rust_payout_math_matches_shared_fixtures() {
    for fixture in &fixtures().payouts {
        assert_eq!(
            calculate_payout(
                fixture.amount.parse().unwrap(),
                fixture.numerator.parse().unwrap(),
                fixture.denominator.parse().unwrap(),
            )
            .unwrap(),
            fixture.payout.parse::<u64>().unwrap(),
            "{}",
            fixture.name
        );
    }
}

fn hex(value: &str) -> [u8; 32] {
    assert_eq!(value.len(), 64);
    let mut result = [0; 32];
    for (index, byte) in result.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
    }
    result
}
