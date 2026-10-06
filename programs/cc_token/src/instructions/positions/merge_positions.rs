use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct MergePositions {}

pub fn merge_positions(_ctx: Context<MergePositions>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
