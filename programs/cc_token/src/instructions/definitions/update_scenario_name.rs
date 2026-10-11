use anchor_lang::prelude::*;

use crate::{
    constants::{SCENARIO_SEED, STATE_VERSION},
    events::ScenarioNameUpdated,
    prelude::*,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct UpdateScenarioNameArgs {
    pub name: String,
}

#[derive(Accounts)]
pub struct UpdateScenarioName<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [SCENARIO_SEED, scenario.creator.as_ref(), scenario.anchor_position_id.as_ref()],
        bump = scenario.bump,
        constraint = scenario.creator == creator.key() @ CcTokenError::UnauthorizedScenarioCreator
    )]
    pub scenario: Account<'info, ScenarioDefinition>,
}

pub fn update_scenario_name(
    ctx: Context<UpdateScenarioName>,
    args: UpdateScenarioNameArgs,
) -> CcTokenResult {
    ScenarioDefinition::validate_name(&args.name)?;
    let scenario = &mut ctx.accounts.scenario;
    require!(
        scenario.version == STATE_VERSION,
        CcTokenError::ScenarioMismatch
    );
    if scenario.name == args.name {
        return Ok(());
    }

    scenario.name = args.name;
    emit!(ScenarioNameUpdated {
        scenario: scenario.key(),
        creator: scenario.creator,
        name: scenario.name.clone(),
    });
    Ok(())
}
