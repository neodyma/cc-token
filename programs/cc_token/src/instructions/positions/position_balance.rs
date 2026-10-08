use anchor_lang::prelude::*;

use crate::{
    constants::{BALANCE_SEED, POSITION_SEED, STATE_VERSION},
    identity::derive_position_id,
    prelude::*,
};

#[derive(Clone, Copy)]
pub enum BalanceOperation {
    Credit,
    Debit,
}

pub struct BalanceUpdate<'info> {
    account: AccountInfo<'info>,
    balance: PositionBalance,
}

pub fn validate_balance_update<'info>(
    position_account: &AccountInfo<'info>,
    balance_account: &AccountInfo<'info>,
    fixed_accounts: &[Pubkey],
    seen_accounts: &mut Vec<Pubkey>,
    owner: Pubkey,
    collateral_mint: Pubkey,
    collection_id: [u8; 32],
    amount: u64,
    operation: BalanceOperation,
) -> CcTokenResult<BalanceUpdate<'info>> {
    validate_unique_account(position_account, fixed_accounts, seen_accounts)?;
    validate_unique_account(balance_account, fixed_accounts, seen_accounts)?;
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
            .checked_add(amount)
            .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?,
        BalanceOperation::Debit => balance
            .amount
            .checked_sub(amount)
            .ok_or_else(|| error!(CcTokenError::InsufficientPositionBalance))?,
    };

    Ok(BalanceUpdate {
        account: balance_account.clone(),
        balance,
    })
}

pub fn apply_balance_updates(updates: Vec<BalanceUpdate<'_>>) -> CcTokenResult {
    for update in updates {
        let mut data = update.account.try_borrow_mut_data()?;
        update.balance.try_serialize(&mut &mut data[..])?;
    }
    Ok(())
}

pub fn validate_position(
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

pub fn validate_position_identity(
    address: &Pubkey,
    position: &PositionDefinition,
) -> CcTokenResult {
    let position_id = derive_position_id(&position.collateral_mint, position.collection_id)?;
    validate_position(
        address,
        position,
        position.collateral_mint,
        position.collection_id,
        position_id,
    )
}

pub fn validate_balance(
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

fn validate_unique_account(
    account: &AccountInfo,
    fixed_accounts: &[Pubkey],
    seen_accounts: &mut Vec<Pubkey>,
) -> CcTokenResult {
    require!(
        !fixed_accounts.contains(account.key) && !seen_accounts.contains(account.key),
        CcTokenError::DuplicateAccount
    );
    seen_accounts.push(*account.key);
    Ok(())
}

fn deserialize_position(account: &AccountInfo) -> CcTokenResult<PositionDefinition> {
    PositionDefinition::try_deserialize(&mut account.try_borrow_data()?.as_ref())
}

fn deserialize_balance(account: &AccountInfo) -> CcTokenResult<PositionBalance> {
    PositionBalance::try_deserialize(&mut account.try_borrow_data()?.as_ref())
}
