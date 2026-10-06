use anchor_lang::prelude::*;

#[error_code]
pub enum CcTokenError {
    #[msg("Instruction is not implemented")]
    InstructionNotImplemented,
}
