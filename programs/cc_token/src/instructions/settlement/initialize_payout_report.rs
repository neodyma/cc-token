use anchor_lang::prelude::*;

use crate::{
    constants::{CONDITION_SEED, PAYOUT_REPORT_SEED, STATE_VERSION},
    prelude::*,
};

#[derive(Accounts)]
pub struct InitializePayoutReport<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub resolver: Signer<'info>,
    #[account(
        seeds = [CONDITION_SEED, condition.condition_id.as_ref()],
        bump = condition.bump,
        has_one = resolver @ CcTokenError::UnauthorizedResolver,
        constraint = condition.status == ConditionStatus::Unresolved
            @ CcTokenError::ConditionAlreadyResolved
    )]
    pub condition: Account<'info, Condition>,
    #[account(
        init,
        payer = payer,
        space = PayoutReport::space(condition.outcome_count),
        seeds = [PAYOUT_REPORT_SEED, condition.condition_id.as_ref()],
        bump
    )]
    pub payout_report: Account<'info, PayoutReport>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_payout_report(ctx: Context<InitializePayoutReport>) -> CcTokenResult {
    let condition = &ctx.accounts.condition;
    ctx.accounts.payout_report.set_inner(PayoutReport {
        version: STATE_VERSION,
        condition_id: condition.condition_id,
        resolver: condition.resolver,
        rent_payer: ctx.accounts.payer.key(),
        outcome_count: condition.outcome_count,
        payout_denominator: 0,
        bump: ctx.bumps.payout_report,
        payout_numerators: Vec::new(),
    });
    Ok(())
}
