use anchor_lang::prelude::*;

use crate::{
    constants::{BALANCE_SEED, COLLECTION_SEED, CONDITION_SEED, POSITION_SEED},
    events::PositionsMerged,
    instructions::positions::{
        native_position::{
            validate_native_transition, NativePositionArgs, NativeTransitionAccounts,
        },
        position_balance::{apply_balance_updates, BalanceOperation},
    },
    prelude::*,
};

#[derive(Accounts)]
#[instruction(args: NativePositionArgs)]
pub struct MergePositions<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [CONDITION_SEED, args.condition_id.as_ref()],
        bump = condition.bump
    )]
    pub condition: Account<'info, Condition>,
    #[account(
        seeds = [POSITION_SEED, destination_position.position_id.as_ref()],
        bump = destination_position.bump
    )]
    pub destination_position: Account<'info, PositionDefinition>,
    #[account(
        mut,
        seeds = [BALANCE_SEED, owner.key().as_ref(), destination_position.position_id.as_ref()],
        bump = destination_balance.bump
    )]
    pub destination_balance: Account<'info, PositionBalance>,
    #[account(
        seeds = [COLLECTION_SEED, args.parent_collection_id.as_ref()],
        bump = parent_collection.bump
    )]
    pub parent_collection: Option<Account<'info, CollectionDefinition>>,
}

pub fn merge_positions(ctx: Context<MergePositions>, args: NativePositionArgs) -> CcTokenResult {
    let fixed_accounts = fixed_account_keys(&ctx.accounts);
    let transition = validate_native_transition(
        ctx.remaining_accounts,
        &fixed_accounts,
        NativeTransitionAccounts {
            owner: ctx.accounts.owner.key(),
            condition: &ctx.accounts.condition,
            parent_collection: ctx.accounts.parent_collection.as_deref(),
            boundary_position_address: ctx.accounts.destination_position.key(),
            boundary_position: &ctx.accounts.destination_position,
            boundary_balance_address: ctx.accounts.destination_balance.key(),
            boundary_balance: &ctx.accounts.destination_balance,
        },
        &args,
        BalanceOperation::Debit,
    )?;

    ctx.accounts.destination_balance.amount = transition.boundary_amount;
    apply_balance_updates(transition.child_updates)?;

    emit!(PositionsMerged {
        owner: ctx.accounts.owner.key(),
        collateral_mint: ctx.accounts.destination_position.collateral_mint,
        destination_position_id: ctx.accounts.destination_position.position_id,
        condition_id: args.condition_id,
        amount: args.amount,
        position_count: args.partition.len() as u16,
    });
    Ok(())
}

fn fixed_account_keys(accounts: &MergePositions) -> Vec<Pubkey> {
    let mut keys = vec![
        accounts.owner.key(),
        accounts.condition.key(),
        accounts.destination_position.key(),
        accounts.destination_balance.key(),
    ];
    if let Some(parent_collection) = &accounts.parent_collection {
        keys.push(parent_collection.key());
    }
    keys
}
