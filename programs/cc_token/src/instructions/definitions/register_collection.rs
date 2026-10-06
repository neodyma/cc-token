use anchor_lang::prelude::*;

use crate::{
    constants::{COLLECTION_SEED, CONDITION_SEED, ROOT_COLLECTION_ID, STATE_VERSION},
    events::CollectionRegistered,
    identity::derive_collection_id,
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RegisterCollectionArgs {
    pub collection_id: [u8; 32],
    pub parent_collection_id: [u8; 32],
    pub condition_id: [u8; 32],
    pub index_set: IndexSet,
}

#[derive(Accounts)]
#[instruction(args: RegisterCollectionArgs)]
pub struct RegisterCollection<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [CONDITION_SEED, args.condition_id.as_ref()],
        bump = condition.bump
    )]
    pub condition: Account<'info, Condition>,
    #[account(
        init_if_needed,
        payer = payer,
        space = CollectionDefinition::SPACE,
        seeds = [COLLECTION_SEED, args.collection_id.as_ref()],
        bump
    )]
    pub collection: Account<'info, CollectionDefinition>,
    pub system_program: Program<'info, System>,
    #[account(
        seeds = [COLLECTION_SEED, args.parent_collection_id.as_ref()],
        bump = parent_collection.bump
    )]
    pub parent_collection: Option<Account<'info, CollectionDefinition>>,
}

pub fn register_collection(
    ctx: Context<RegisterCollection>,
    args: RegisterCollectionArgs,
) -> CcTokenResult {
    validate_condition(&ctx.accounts.condition, args.condition_id)?;
    args.index_set
        .validate(ctx.accounts.condition.outcome_count)?;
    validate_parent(
        ctx.accounts.parent_collection.as_deref(),
        args.parent_collection_id,
    )?;

    let derived =
        derive_collection_id(args.parent_collection_id, args.condition_id, args.index_set)?;
    require!(
        derived.collection_id == args.collection_id,
        CcTokenError::InvalidCollectionId
    );

    let collection = &mut ctx.accounts.collection;
    if collection.version == 0 {
        collection.set_inner(CollectionDefinition {
            version: STATE_VERSION,
            collection_id: derived.collection_id,
            parent_collection_id: args.parent_collection_id,
            condition_id: args.condition_id,
            index_set: args.index_set,
            bump: ctx.bumps.collection,
        });
        emit!(CollectionRegistered {
            collection_id: derived.collection_id,
            parent_collection_id: args.parent_collection_id,
            condition_id: args.condition_id,
            index_set: args.index_set,
            hash_attempts: derived.hash_attempts,
        });
        return Ok(());
    }

    require!(
        collection.version == STATE_VERSION
            && collection.collection_id == derived.collection_id
            && collection.bump == ctx.bumps.collection,
        CcTokenError::CollectionMismatch
    );

    Ok(())
}

fn validate_condition(condition: &Condition, condition_id: [u8; 32]) -> CcTokenResult {
    require!(
        condition.version == STATE_VERSION && condition.condition_id == condition_id,
        CcTokenError::ConditionMismatch
    );
    Ok(())
}

fn validate_parent(
    parent_collection: Option<&CollectionDefinition>,
    parent_collection_id: [u8; 32],
) -> CcTokenResult {
    if parent_collection_id == ROOT_COLLECTION_ID {
        require!(
            parent_collection.is_none(),
            CcTokenError::UnexpectedParentCollection
        );
        return Ok(());
    }

    let parent_collection =
        parent_collection.ok_or_else(|| error!(CcTokenError::MissingParentCollection))?;
    require!(
        parent_collection.version == STATE_VERSION
            && parent_collection.collection_id == parent_collection_id,
        CcTokenError::ParentCollectionMismatch
    );
    Ok(())
}
