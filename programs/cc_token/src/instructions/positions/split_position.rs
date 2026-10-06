use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct SplitPosition {}

pub fn split_position(_ctx: Context<SplitPosition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
