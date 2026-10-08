use anchor_lang::prelude::*;

use crate::{
    constants::{ROOT_COLLECTION_ID, STATE_VERSION},
    identity::{derive_collection_id, derive_position_id},
    instructions::positions::position_balance::{
        validate_balance, validate_balance_update, validate_position, BalanceOperation,
        BalanceUpdate,
    },
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct NativePositionArgs {
    pub parent_collection_id: [u8; 32],
    pub condition_id: [u8; 32],
    pub partition: Vec<IndexSet>,
    pub amount: u64,
}

pub struct NativeTransition<'info> {
    pub boundary_amount: u64,
    pub child_updates: Vec<BalanceUpdate<'info>>,
}

pub struct NativeTransitionAccounts<'a> {
    pub owner: Pubkey,
    pub condition: &'a Condition,
    pub parent_collection: Option<&'a CollectionDefinition>,
    pub boundary_position_address: Pubkey,
    pub boundary_position: &'a PositionDefinition,
    pub boundary_balance_address: Pubkey,
    pub boundary_balance: &'a PositionBalance,
}

pub fn validate_native_transition<'info>(
    remaining_accounts: &[AccountInfo<'info>],
    fixed_accounts: &[Pubkey],
    accounts: NativeTransitionAccounts<'_>,
    args: &NativePositionArgs,
    child_operation: BalanceOperation,
) -> CcTokenResult<NativeTransition<'info>> {
    require!(args.amount > 0, CcTokenError::ZeroAmount);
    require!(
        accounts.condition.version == STATE_VERSION
            && accounts.condition.condition_id == args.condition_id,
        CcTokenError::ConditionMismatch
    );
    validate_parent(accounts.parent_collection, args.parent_collection_id)?;

    let partition = validate_partition(accounts.condition.outcome_count, &args.partition)?;
    require!(
        args.parent_collection_id != ROOT_COLLECTION_ID || !partition.is_full,
        CcTokenError::RootCollateralRequired
    );
    require!(
        remaining_accounts.len() == args.partition.len() * 2,
        CcTokenError::InvalidRemainingAccounts
    );

    let boundary_collection_id = if partition.is_full {
        args.parent_collection_id
    } else {
        derive_collection_id(
            args.parent_collection_id,
            args.condition_id,
            partition.union,
        )?
        .collection_id
    };
    let collateral_mint = accounts.boundary_position.collateral_mint;
    let boundary_position_id = derive_position_id(&collateral_mint, boundary_collection_id)?;
    validate_position(
        &accounts.boundary_position_address,
        accounts.boundary_position,
        collateral_mint,
        boundary_collection_id,
        boundary_position_id,
    )?;
    validate_balance(
        &accounts.boundary_balance_address,
        accounts.boundary_balance,
        accounts.owner,
        boundary_position_id,
    )?;

    let boundary_amount = match child_operation {
        BalanceOperation::Credit => accounts
            .boundary_balance
            .amount
            .checked_sub(args.amount)
            .ok_or_else(|| error!(CcTokenError::InsufficientPositionBalance))?,
        BalanceOperation::Debit => accounts
            .boundary_balance
            .amount
            .checked_add(args.amount)
            .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?,
    };

    let mut seen_accounts = Vec::with_capacity(remaining_accounts.len());
    let mut child_updates = Vec::with_capacity(args.partition.len());
    for (index, subset) in args.partition.iter().copied().enumerate() {
        let child_collection_id =
            derive_collection_id(args.parent_collection_id, args.condition_id, subset)?
                .collection_id;
        child_updates.push(validate_balance_update(
            &remaining_accounts[index * 2],
            &remaining_accounts[index * 2 + 1],
            fixed_accounts,
            &mut seen_accounts,
            accounts.owner,
            collateral_mint,
            child_collection_id,
            args.amount,
            child_operation,
        )?);
    }

    Ok(NativeTransition {
        boundary_amount,
        child_updates,
    })
}

pub fn validate_parent(
    parent_collection: Option<&CollectionDefinition>,
    parent_collection_id: [u8; 32],
) -> CcTokenResult {
    if parent_collection_id == ROOT_COLLECTION_ID {
        require!(
            parent_collection.is_none(),
            CcTokenError::UnexpectedParentCollection
        );
        return Ok(());
    }

    let parent_collection =
        parent_collection.ok_or_else(|| error!(CcTokenError::MissingParentCollection))?;
    require!(
        parent_collection.version == STATE_VERSION
            && parent_collection.collection_id == parent_collection_id,
        CcTokenError::ParentCollectionMismatch
    );
    Ok(())
}
