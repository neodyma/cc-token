use anchor_lang::prelude::*;

use crate::{
    constants::{CONDITION_SEED, PAYOUT_REPORT_SEED},
    prelude::*,
};

use super::resolve_condition;

#[derive(Accounts)]
pub struct FinalizePayoutReport<'info> {
    pub resolver: Signer<'info>,
    #[account(
        mut,
        seeds = [CONDITION_SEED, condition.condition_id.as_ref()],
        bump = condition.bump,
        has_one = resolver @ CcTokenError::UnauthorizedResolver
    )]
    pub condition: Account<'info, Condition>,
    #[account(
        mut,
        close = rent_refund,
        seeds = [PAYOUT_REPORT_SEED, condition.condition_id.as_ref()],
        bump = payout_report.bump,
        has_one = resolver @ CcTokenError::UnauthorizedResolver,
        constraint = payout_report.condition_id == condition.condition_id
            @ CcTokenError::PayoutReportMismatch,
        constraint = payout_report.rent_payer == rent_refund.key()
            @ CcTokenError::PayoutReportMismatch
    )]
    pub payout_report: Account<'info, PayoutReport>,
    #[account(mut)]
    pub rent_refund: SystemAccount<'info>,
}

pub fn finalize_payout_report(ctx: Context<FinalizePayoutReport>) -> CcTokenResult {
    ctx.accounts
        .payout_report
        .validate_complete(&ctx.accounts.condition)?;
    let payout_numerators = std::mem::take(&mut ctx.accounts.payout_report.payout_numerators);
    resolve_condition(&mut ctx.accounts.condition, payout_numerators)
}
