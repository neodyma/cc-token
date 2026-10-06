use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct CompressPosition {}

pub fn compress_position(_ctx: Context<CompressPosition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
