use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct TransferPosition {}

pub fn transfer_position(_ctx: Context<TransferPosition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
