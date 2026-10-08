use anchor_lang::prelude::*;

use crate::{
    constants::STATE_VERSION,
    identity::{derive_collection_id, derive_position_id},
    instructions::positions::{validate_balance, validate_position},
    math::{payout_ratio, IndexSet},
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RedeemPositionArgs {
    pub condition_id: [u8; 32],
    pub index_set: IndexSet,
    pub amount: u64,
}

pub struct Redemption {
    pub payout: u64,
    pub source_amount: u64,
}

pub fn validate_redemption(
    condition: &Condition,
    source_position_address: Pubkey,
    source_position: &PositionDefinition,
    source_balance_address: Pubkey,
    source_balance: &PositionBalance,
    owner: Pubkey,
    parent_collection_id: [u8; 32],
    args: &RedeemPositionArgs,
) -> CcTokenResult<Redemption> {
    require!(args.amount > 0, CcTokenError::ZeroAmount);
    require!(
        condition.version == STATE_VERSION
            && condition.condition_id == args.condition_id
            && condition.condition_id
                == Condition::derive_id(
                    &condition.resolver,
                    &condition.question_id,
                    condition.outcome_count,
                ),
        CcTokenError::ConditionMismatch
    );
    require!(
        condition.status == ConditionStatus::Resolved,
        CcTokenError::ConditionNotResolved
    );

    let ratio = payout_ratio(&condition.payout_numerators, args.index_set)?;
    require!(
        ratio.denominator == condition.payout_denominator,
        CcTokenError::ConditionMismatch
    );
    let payout = calculate_payout(args.amount, ratio.numerator, ratio.denominator)?;

    let source_collection_id =
        derive_collection_id(parent_collection_id, args.condition_id, args.index_set)?
            .collection_id;
    let source_position_id =
        derive_position_id(&source_position.collateral_mint, source_collection_id)?;
    validate_position(
        &source_position_address,
        source_position,
        source_position.collateral_mint,
        source_collection_id,
        source_position_id,
    )?;
    validate_balance(
        &source_balance_address,
        source_balance,
        owner,
        source_position_id,
    )?;

    let source_amount = source_balance
        .amount
        .checked_sub(args.amount)
        .ok_or_else(|| error!(CcTokenError::InsufficientPositionBalance))?;
    Ok(Redemption {
        payout,
        source_amount,
    })
}
