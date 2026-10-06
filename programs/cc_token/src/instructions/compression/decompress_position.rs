use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct DecompressPosition {}

pub fn decompress_position(_ctx: Context<DecompressPosition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
