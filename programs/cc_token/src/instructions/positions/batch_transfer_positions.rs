use anchor_lang::prelude::*;

use crate::{
    constants::MAX_BATCH_TRANSFERS,
    events::PositionsBatchTransferred,
    instructions::positions::position_balance::{
        apply_balance_updates, deserialize_balance, deserialize_position, validate_balance,
        validate_position_identity, BalanceUpdate,
    },
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct BatchTransferPositionsArgs {
    pub recipient: Pubkey,
    pub position_ids: Vec<[u8; 32]>,
    pub amounts: Vec<u64>,
}

#[derive(Accounts)]
pub struct BatchTransferPositions<'info> {
    pub owner: Signer<'info>,
    /// CHECK: The recipient identifies canonical balance PDAs and does not authorize the transfer.
    pub recipient: UncheckedAccount<'info>,
}

pub fn batch_transfer_positions(
    ctx: Context<BatchTransferPositions>,
    args: BatchTransferPositionsArgs,
) -> CcTokenResult {
    require!(!args.amounts.is_empty(), CcTokenError::EmptyTransferBatch);
    require!(
        args.amounts.len() <= MAX_BATCH_TRANSFERS,
        CcTokenError::TransferBatchTooLarge
    );
    require!(
        args.position_ids.len() == args.amounts.len()
            && ctx.remaining_accounts.len() == args.amounts.len() * 3,
        CcTokenError::InvalidTransferAccounts
    );

    let owner = ctx.accounts.owner.key();
    let recipient = ctx.accounts.recipient.key();
    require_keys_eq!(
        recipient,
        args.recipient,
        CcTokenError::InvalidTransferDestination
    );
    require_keys_neq!(owner, recipient, CcTokenError::SelfTransfer);
    let mut position_ids = Vec::with_capacity(args.amounts.len());
    let mut balance_addresses = Vec::with_capacity(args.amounts.len() * 2);
    let mut updates = Vec::with_capacity(args.amounts.len() * 2);

    for (index, amount) in args.amounts.iter().copied().enumerate() {
        require!(amount > 0, CcTokenError::ZeroAmount);
        let position_account = &ctx.remaining_accounts[index * 3];
        let source_account = &ctx.remaining_accounts[index * 3 + 1];
        let destination_account = &ctx.remaining_accounts[index * 3 + 2];

        let position = deserialize_position(position_account)?;
        validate_position_identity(&position_account.key(), &position)?;
        require!(
            position.position_id == args.position_ids[index],
            CcTokenError::PositionMismatch
        );
        require!(
            !position_ids.contains(&position.position_id),
            CcTokenError::DuplicateTransferEntry
        );
        position_ids.push(position.position_id);

        validate_transfer_accounts(
            position_account,
            source_account,
            destination_account,
            owner,
            recipient,
            &mut balance_addresses,
        )?;

        let mut source_balance = deserialize_balance(source_account)?;
        validate_balance(
            &source_account.key(),
            &source_balance,
            owner,
            position.position_id,
        )?;
        require!(
            source_balance.amount >= amount,
            CcTokenError::InsufficientPositionBalance
        );

        let mut destination_balance = deserialize_balance(destination_account)?;
        validate_balance(
            &destination_account.key(),
            &destination_balance,
            recipient,
            position.position_id,
        )?;

        source_balance.amount = source_balance
            .amount
            .checked_sub(amount)
            .ok_or_else(|| error!(CcTokenError::InsufficientPositionBalance))?;
        destination_balance.amount = destination_balance
            .amount
            .checked_add(amount)
            .ok_or_else(|| error!(CcTokenError::ArithmeticOverflow))?;
        updates.push(BalanceUpdate::new(source_account, source_balance));
        updates.push(BalanceUpdate::new(destination_account, destination_balance));
    }

    apply_balance_updates(updates)?;
    emit!(PositionsBatchTransferred {
        source_owner: owner,
        destination_owner: recipient,
        position_count: args.amounts.len() as u16,
    });
    Ok(())
}

fn validate_transfer_accounts(
    position: &AccountInfo,
    source: &AccountInfo,
    destination: &AccountInfo,
    owner: Pubkey,
    recipient: Pubkey,
    balance_addresses: &mut Vec<Pubkey>,
) -> CcTokenResult {
    require!(
        position.key() != owner
            && position.key() != recipient
            && source.key() != owner
            && source.key() != recipient
            && destination.key() != owner
            && destination.key() != recipient,
        CcTokenError::DuplicateAccount
    );
    require!(
        source.is_writable && destination.is_writable,
        CcTokenError::AccountNotWritable
    );
    require_keys_eq!(*position.owner, crate::ID, CcTokenError::PositionMismatch);
    require_keys_eq!(
        *source.owner,
        crate::ID,
        CcTokenError::PositionBalanceMismatch
    );
    require_keys_eq!(
        *destination.owner,
        crate::ID,
        CcTokenError::PositionBalanceMismatch
    );
    require!(
        !balance_addresses.contains(&source.key()),
        CcTokenError::DuplicateAccount
    );
    balance_addresses.push(source.key());
    require!(
        !balance_addresses.contains(&destination.key()),
        CcTokenError::DuplicateAccount
    );
    balance_addresses.push(destination.key());
    Ok(())
}
