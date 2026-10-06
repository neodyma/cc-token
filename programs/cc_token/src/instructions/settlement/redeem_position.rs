use anchor_lang::prelude::*;

use crate::prelude::*;

#[derive(Accounts)]
pub struct RedeemPosition {}

pub fn redeem_position(_ctx: Context<RedeemPosition>) -> CcTokenResult {
    err!(CcTokenError::InstructionNotImplemented)
}
