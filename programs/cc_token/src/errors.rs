use anchor_lang::prelude::*;

#[error_code]
pub enum CcTokenError {
    #[msg("Instruction is not implemented")]
    InstructionNotImplemented,
    #[msg("Outcome count must be between 2 and 256")]
    InvalidOutcomeCount,
    #[msg("Condition ID does not match its definition")]
    InvalidConditionId,
    #[msg("Condition account does not match its definition")]
    ConditionMismatch,
    #[msg("Index set must contain at least one outcome")]
    EmptyIndexSet,
    #[msg("Index set contains an outcome outside the condition")]
    IndexSetOutOfRange,
    #[msg("Index set must be a proper subset of the condition outcomes")]
    FullIndexSet,
    #[msg("A partition must contain at least two subsets")]
    PartitionTooSmall,
    #[msg("Partition subsets must not overlap")]
    PartitionOverlap,
    #[msg("The collateral root does not have a position ID")]
    RootPosition,
    #[msg("Payout denominator must be greater than zero")]
    ZeroPayoutDenominator,
    #[msg("Payout numerator must not exceed its denominator")]
    InvalidPayoutFraction,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Collection ID does not match its construction")]
    InvalidCollectionId,
    #[msg("Root collections must not provide a parent account")]
    UnexpectedParentCollection,
    #[msg("Non-root collections require their registered parent account")]
    MissingParentCollection,
    #[msg("Parent collection does not match the requested parent ID")]
    ParentCollectionMismatch,
    #[msg("Collection point is not a valid BN254 encoding")]
    InvalidCollectionPoint,
    #[msg("BN254 operation failed")]
    CurveOperationFailed,
    #[msg("Collection composition produced the identity point")]
    IdentityPoint,
    #[msg("Collection account does not match its registered definition")]
    CollectionMismatch,
}
