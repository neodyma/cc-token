use anchor_lang::prelude::*;

use crate::math::IndexSet;

#[event]
pub struct ConditionPrepared {
    pub condition_id: [u8; 32],
    pub resolver: Pubkey,
    pub question_id: [u8; 32],
    pub outcome_count: u16,
}

#[event]
pub struct CollectionRegistered {
    pub collection_id: [u8; 32],
    pub parent_collection_id: [u8; 32],
    pub condition_id: [u8; 32],
    pub index_set: IndexSet,
    pub hash_attempts: u32,
}

#[event]
pub struct CollateralRegistered {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub vault: Pubkey,
    pub decimals: u8,
}

#[event]
pub struct PositionRegistered {
    pub position_id: [u8; 32],
    pub collateral_mint: Pubkey,
    pub collection_id: [u8; 32],
}

#[event]
pub struct PositionBalanceInitialized {
    pub owner: Pubkey,
    pub position_id: [u8; 32],
}

#[event]
pub struct PositionBalanceClosed {
    pub owner: Pubkey,
    pub position_id: [u8; 32],
}

#[event]
pub struct PayoutsReported {
    pub condition_id: [u8; 32],
    pub resolver: Pubkey,
    pub outcome_count: u16,
    pub payout_denominator: u128,
}
