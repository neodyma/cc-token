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
    #[msg("Collateral mint uses an unsupported Token-2022 extension")]
    UnsupportedCollateralExtension,
    #[msg("Collateral account does not match its registered definition")]
    CollateralMismatch,
    #[msg("Position ID does not match its definition")]
    InvalidPositionId,
    #[msg("Position account does not match its registered definition")]
    PositionMismatch,
    #[msg("Position balance does not match its registered owner and position")]
    PositionBalanceMismatch,
    #[msg("A nonzero position balance cannot be closed")]
    NonzeroPositionBalance,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("A collateral split or merge requires a full partition")]
    FullCoverRequired,
    #[msg("A root full-partition transition requires a collateral handler")]
    RootCollateralRequired,
    #[msg("Remaining accounts must contain one position and balance pair per partition item")]
    InvalidRemainingAccounts,
    #[msg("An account required for mutation is not writable")]
    AccountNotWritable,
    #[msg("An account appears more than once in the instruction")]
    DuplicateAccount,
    #[msg("Position balance is insufficient")]
    InsufficientPositionBalance,
    #[msg("A single transfer requires exactly one destination balance account")]
    InvalidTransferDestination,
    #[msg("Source and destination owners must differ")]
    SelfTransfer,
    #[msg("A transfer batch must contain at least one position")]
    EmptyTransferBatch,
    #[msg("A transfer batch contains too many positions")]
    TransferBatchTooLarge,
    #[msg("Transfer accounts must contain one position, source and destination per amount")]
    InvalidTransferAccounts,
    #[msg("A transfer batch must not contain the same position more than once")]
    DuplicateTransferEntry,
    #[msg("Collateral token balance is insufficient")]
    InsufficientCollateral,
    #[msg("Only the condition resolver may report payouts")]
    UnauthorizedResolver,
    #[msg("Condition payouts have already been reported")]
    ConditionAlreadyResolved,
    #[msg("Payout numerator count must equal the condition outcome count")]
    PayoutNumeratorCountMismatch,
    #[msg("A payout report chunk must contain at least one numerator")]
    EmptyPayoutChunk,
    #[msg("Payout report contains more numerators than the condition")]
    PayoutReportTooLong,
    #[msg("Payout report does not contain every condition outcome")]
    IncompletePayoutReport,
    #[msg("Payout report does not match its condition")]
    PayoutReportMismatch,
}
