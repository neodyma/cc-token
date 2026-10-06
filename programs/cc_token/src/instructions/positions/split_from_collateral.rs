use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct SplitFromCollateral {}

pub fn split_from_collateral(_ctx: Context<SplitFromCollateral>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
