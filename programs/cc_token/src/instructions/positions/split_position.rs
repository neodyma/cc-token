use anchor_lang::prelude::*;

use crate::{
    constants::{BALANCE_SEED, COLLECTION_SEED, CONDITION_SEED, POSITION_SEED},
    events::PositionSplit,
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
pub struct SplitPosition<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [CONDITION_SEED, args.condition_id.as_ref()],
        bump = condition.bump
    )]
    pub condition: Account<'info, Condition>,
    #[account(
        seeds = [POSITION_SEED, source_position.position_id.as_ref()],
        bump = source_position.bump
    )]
    pub source_position: Account<'info, PositionDefinition>,
    #[account(
        mut,
        seeds = [BALANCE_SEED, owner.key().as_ref(), source_position.position_id.as_ref()],
        bump = source_balance.bump
    )]
    pub source_balance: Account<'info, PositionBalance>,
    #[account(
        seeds = [COLLECTION_SEED, args.parent_collection_id.as_ref()],
        bump = parent_collection.bump
    )]
    pub parent_collection: Option<Account<'info, CollectionDefinition>>,
}

pub fn split_position(ctx: Context<SplitPosition>, args: NativePositionArgs) -> CcTokenResult {
    let fixed_accounts = fixed_account_keys(&ctx.accounts);
    let transition = validate_native_transition(
        ctx.remaining_accounts,
        &fixed_accounts,
        NativeTransitionAccounts {
            owner: ctx.accounts.owner.key(),
            condition: &ctx.accounts.condition,
            parent_collection: ctx.accounts.parent_collection.as_deref(),
            boundary_position_address: ctx.accounts.source_position.key(),
            boundary_position: &ctx.accounts.source_position,
            boundary_balance_address: ctx.accounts.source_balance.key(),
            boundary_balance: &ctx.accounts.source_balance,
        },
        &args,
        BalanceOperation::Credit,
    )?;

    ctx.accounts.source_balance.amount = transition.boundary_amount;
    apply_balance_updates(transition.child_updates)?;

    emit!(PositionSplit {
        owner: ctx.accounts.owner.key(),
        collateral_mint: ctx.accounts.source_position.collateral_mint,
        source_position_id: ctx.accounts.source_position.position_id,
        condition_id: args.condition_id,
        amount: args.amount,
        position_count: args.partition.len() as u16,
    });
    Ok(())
}

fn fixed_account_keys(accounts: &SplitPosition) -> Vec<Pubkey> {
    let mut keys = vec![
        accounts.owner.key(),
        accounts.condition.key(),
        accounts.source_position.key(),
        accounts.source_balance.key(),
    ];
    if let Some(parent_collection) = &accounts.parent_collection {
        keys.push(parent_collection.key());
    }
    keys
}
