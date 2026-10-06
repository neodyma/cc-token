use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct MergeToCollateral {}

pub fn merge_to_collateral(_ctx: Context<MergeToCollateral>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
