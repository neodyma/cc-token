use anchor_lang::prelude::*;

use crate::{
    constants::{CONDITION_SEED, STATE_VERSION},
    events::ConditionPrepared,
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct PrepareConditionArgs {
    pub condition_id: [u8; 32],
    pub resolver: Pubkey,
    pub question_id: [u8; 32],
    pub outcome_count: u16,
}

#[derive(Accounts)]
#[instruction(args: PrepareConditionArgs)]
pub struct PrepareCondition<'info> {
    #[account(
        mut,
        constraint = (MIN_OUTCOME_COUNT..=MAX_OUTCOME_COUNT).contains(&args.outcome_count)
            @ CcTokenError::InvalidOutcomeCount
    )]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = Condition::space(args.outcome_count),
        seeds = [CONDITION_SEED, args.condition_id.as_ref()],
        bump
    )]
    pub condition: Account<'info, Condition>,
    pub system_program: Program<'info, System>,
}

pub fn prepare_condition(
    ctx: Context<PrepareCondition>,
    args: PrepareConditionArgs,
) -> CcTokenResult {
    let condition_id = Condition::derive_id(&args.resolver, &args.question_id, args.outcome_count);
    require!(
        condition_id == args.condition_id,
        CcTokenError::InvalidConditionId
    );

    let condition = &mut ctx.accounts.condition;
    if condition.version == 0 {
        condition.set_inner(Condition {
            version: STATE_VERSION,
            condition_id,
            resolver: args.resolver,
            question_id: args.question_id,
            outcome_count: args.outcome_count,
            status: ConditionStatus::Unresolved,
            payout_numerators: vec![0; usize::from(args.outcome_count)],
            payout_denominator: 0,
            bump: ctx.bumps.condition,
        });
        emit!(ConditionPrepared {
            condition_id,
            resolver: args.resolver,
            question_id: args.question_id,
            outcome_count: args.outcome_count,
        });
        return Ok(());
    }

    require!(
        condition.version == STATE_VERSION
            && condition.condition_id == condition_id
            && condition.resolver == args.resolver
            && condition.question_id == args.question_id
            && condition.outcome_count == args.outcome_count
            && condition.bump == ctx.bumps.condition,
        CcTokenError::ConditionMismatch
    );

    Ok(())
}
