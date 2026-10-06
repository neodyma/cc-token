use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct BatchTransferPositions {}

pub fn batch_transfer_positions(_ctx: Context<BatchTransferPositions>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
