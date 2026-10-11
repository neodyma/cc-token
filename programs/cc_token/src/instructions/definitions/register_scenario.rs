use anchor_lang::prelude::*;

use crate::{
    constants::{POSITION_SEED, SCENARIO_SEED, STATE_VERSION},
    events::ScenarioRegistered,
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RegisterScenarioArgs {
    pub anchor_position_id: [u8; 32],
    pub name: String,
}

#[derive(Accounts)]
#[instruction(args: RegisterScenarioArgs)]
pub struct RegisterScenario<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub creator: Signer<'info>,
    #[account(
        seeds = [POSITION_SEED, args.anchor_position_id.as_ref()],
        bump = anchor_position.bump
    )]
    pub anchor_position: Account<'info, PositionDefinition>,
    #[account(
        init_if_needed,
        payer = payer,
        space = ScenarioDefinition::SPACE,
        seeds = [SCENARIO_SEED, creator.key().as_ref(), args.anchor_position_id.as_ref()],
        bump
    )]
    pub scenario: Account<'info, ScenarioDefinition>,
    pub system_program: Program<'info, System>,
}

pub fn register_scenario(
    ctx: Context<RegisterScenario>,
    args: RegisterScenarioArgs,
) -> CcTokenResult {
    ScenarioDefinition::validate_name(&args.name)?;
    require!(
        ctx.accounts.anchor_position.version == STATE_VERSION
            && ctx.accounts.anchor_position.position_id == args.anchor_position_id,
        CcTokenError::PositionMismatch
    );

    let registered = ScenarioDefinition {
        version: STATE_VERSION,
        creator: ctx.accounts.creator.key(),
        anchor_position_id: args.anchor_position_id,
        registered_slot: Clock::get()?.slot,
        bump: ctx.bumps.scenario,
        name: args.name,
    };
    let scenario = &mut ctx.accounts.scenario;
    if scenario.version == 0 {
        emit!(ScenarioRegistered {
            scenario: scenario.key(),
            creator: registered.creator,
            anchor_position_id: registered.anchor_position_id,
            name: registered.name.clone(),
        });
        scenario.set_inner(registered);
        return Ok(());
    }

    require!(
        scenario.version == registered.version
            && scenario.creator == registered.creator
            && scenario.anchor_position_id == registered.anchor_position_id
            && scenario.bump == registered.bump
            && scenario.name == registered.name,
        CcTokenError::ScenarioMismatch
    );
    Ok(())
}
