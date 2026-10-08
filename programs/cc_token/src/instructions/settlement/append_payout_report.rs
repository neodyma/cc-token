use anchor_lang::prelude::*;

use crate::{
    constants::{CONDITION_SEED, PAYOUT_REPORT_SEED},
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct AppendPayoutReportArgs {
    pub payout_numerators: Vec<u64>,
}

#[derive(Accounts)]
pub struct AppendPayoutReport<'info> {
    pub resolver: Signer<'info>,
    #[account(
        seeds = [CONDITION_SEED, condition.condition_id.as_ref()],
        bump = condition.bump,
        has_one = resolver @ CcTokenError::UnauthorizedResolver
    )]
    pub condition: Account<'info, Condition>,
    #[account(
        mut,
        seeds = [PAYOUT_REPORT_SEED, condition.condition_id.as_ref()],
        bump = payout_report.bump,
        has_one = resolver @ CcTokenError::UnauthorizedResolver,
        constraint = payout_report.condition_id == condition.condition_id
            @ CcTokenError::PayoutReportMismatch
    )]
    pub payout_report: Account<'info, PayoutReport>,
}

pub fn append_payout_report(
    ctx: Context<AppendPayoutReport>,
    args: AppendPayoutReportArgs,
) -> CcTokenResult {
    ctx.accounts
        .payout_report
        .append(&ctx.accounts.condition, &args.payout_numerators)
}
