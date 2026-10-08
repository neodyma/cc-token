use anchor_lang::prelude::*;

use crate::{
    constants::{ROOT_COLLECTION_ID, STATE_VERSION},
    identity::derive_collection_id,
    instructions::positions::position_balance::{
        validate_balance_update, BalanceOperation, BalanceUpdate,
    },
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RootCollateralArgs {
    pub condition_id: [u8; 32],
    pub partition: Vec<IndexSet>,
    pub amount: u64,
}

pub fn validate_root_transition<'info>(
    remaining_accounts: &[AccountInfo<'info>],
    fixed_accounts: &[Pubkey],
    owner: Pubkey,
    collateral_mint: Pubkey,
    condition: &Condition,
    args: &RootCollateralArgs,
    operation: BalanceOperation,
) -> CcTokenResult<Vec<BalanceUpdate<'info>>> {
    require!(args.amount > 0, CcTokenError::ZeroAmount);
    require!(
        condition.version == STATE_VERSION && condition.condition_id == args.condition_id,
        CcTokenError::ConditionMismatch
    );
    let validated = validate_partition(condition.outcome_count, &args.partition)?;
    require!(validated.is_full, CcTokenError::FullCoverRequired);
    require!(
        remaining_accounts.len() == args.partition.len() * 2,
        CcTokenError::InvalidRemainingAccounts
    );

    let mut seen = Vec::with_capacity(remaining_accounts.len());
    let mut updates = Vec::with_capacity(args.partition.len());

    for (index, subset) in args.partition.iter().copied().enumerate() {
        let position_account = &remaining_accounts[index * 2];
        let balance_account = &remaining_accounts[index * 2 + 1];
        let collection_id =
            derive_collection_id(ROOT_COLLECTION_ID, args.condition_id, subset)?.collection_id;
        updates.push(validate_balance_update(
            position_account,
            balance_account,
            fixed_accounts,
            &mut seen,
            owner,
            collateral_mint,
            collection_id,
            args.amount,
            operation,
        )?);
    }

    Ok(updates)
}
