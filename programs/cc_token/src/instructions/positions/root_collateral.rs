use anchor_lang::prelude::*;

use crate::{
    constants::{BALANCE_SEED, POSITION_SEED, ROOT_COLLECTION_ID, STATE_VERSION},
    identity::{derive_collection_id, derive_position_id},
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RootCollateralArgs {
    pub condition_id: [u8; 32],
    pub partition: Vec<IndexSet>,
    pub amount: u64,
}

pub enum BalanceOperation {
    Credit,
    Debit,
}

pub struct BalanceUpdate<'info> {
    account: AccountInfo<'info>,
    balance: PositionBalance,
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
        validate_unique_account(position_account, fixed_accounts, &mut seen)?;
        validate_unique_account(balance_account, fixed_accounts, &mut seen)?;
        require!(
            balance_account.is_writable,
            CcTokenError::AccountNotWritable
        );
        require_keys_eq!(
            *position_account.owner,
            crate::ID,
            CcTokenError::PositionMismatch
        );
        require_keys_eq!(
            *balance_account.owner,
            crate::ID,
            CcTokenError::PositionBalanceMismatch
        );

        let collection_id =
            derive_collection_id(ROOT_COLLECTION_ID, args.condition_id, subset)?.collection_id;
        let position_id = derive_position_id(&collateral_mint, collection_id)?;
        let position = deserialize_position(position_account)?;
        validate_position(
            &position_account.key(),
            &position,
            collateral_mint,
            collection_id,
            position_id,
        )?;

        let mut balance = deserialize_balance(balance_account)?;
        validate_balance(&balance_account.key(), &balance, owner, position_id)?;
        balance.amount = match operation {
            BalanceOperation::Credit => balance
                .amount
                .checked_add(args.amount)
                .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?,
            BalanceOperation::Debit => balance
                .amount
                .checked_sub(args.amount)
                .ok_or_else(|| error!(CcTokenError::InsufficientPositionBalance))?,
        };
        updates.push(BalanceUpdate {
            account: balance_account.clone(),
            balance,
        });
    }

    Ok(updates)
}

pub fn apply_balance_updates(updates: Vec<BalanceUpdate<'_>>) -> CcTokenResult {
    for update in updates {
        let mut data = update.account.try_borrow_mut_data()?;
        update.balance.try_serialize(&mut &mut data[..])?;
    }
    Ok(())
}

fn validate_unique_account(
    account: &AccountInfo,
    fixed_accounts: &[Pubkey],
    seen: &mut Vec<Pubkey>,
) -> CcTokenResult {
    require!(
        !fixed_accounts.contains(account.key) && !seen.contains(account.key),
        CcTokenError::DuplicateAccount
    );
    seen.push(*account.key);
    Ok(())
}

fn deserialize_position(account: &AccountInfo) -> CcTokenResult<PositionDefinition> {
    PositionDefinition::try_deserialize(&mut account.try_borrow_data()?.as_ref())
}

fn deserialize_balance(account: &AccountInfo) -> CcTokenResult<PositionBalance> {
    PositionBalance::try_deserialize(&mut account.try_borrow_data()?.as_ref())
}

fn validate_position(
    address: &Pubkey,
    position: &PositionDefinition,
    collateral_mint: Pubkey,
    collection_id: [u8; 32],
    position_id: [u8; 32],
) -> CcTokenResult {
    let (expected_address, bump) =
        Pubkey::find_program_address(&[POSITION_SEED, position_id.as_ref()], &crate::ID);
    require!(
        *address == expected_address
            && position.version == STATE_VERSION
            && position.position_id == position_id
            && position.collateral_mint == collateral_mint
            && position.collection_id == collection_id
            && position.bump == bump,
        CcTokenError::PositionMismatch
    );
    Ok(())
}

fn validate_balance(
    address: &Pubkey,
    balance: &PositionBalance,
    owner: Pubkey,
    position_id: [u8; 32],
) -> CcTokenResult {
    let (expected_address, bump) = Pubkey::find_program_address(
        &[BALANCE_SEED, owner.as_ref(), position_id.as_ref()],
        &crate::ID,
    );
    require!(
        *address == expected_address
            && balance.version == STATE_VERSION
            && balance.owner == owner
            && balance.position_id == position_id
            && balance.bump == bump,
        CcTokenError::PositionBalanceMismatch
    );
    Ok(())
}
