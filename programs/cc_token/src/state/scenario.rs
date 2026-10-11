use anchor_lang::prelude::*;

use crate::{constants::MAX_SCENARIO_NAME_BYTES, errors::CcTokenError};

#[account]
#[derive(InitSpace)]
pub struct ScenarioDefinition {
    pub version: u8,
    pub creator: Pubkey,
    pub anchor_position_id: [u8; 32],
    pub registered_slot: u64,
    pub bump: u8,
    #[max_len(MAX_SCENARIO_NAME_BYTES)]
    pub name: String,
}

impl ScenarioDefinition {
    pub const SPACE: usize = Self::DISCRIMINATOR.len() + Self::INIT_SPACE;

    pub fn validate_name(name: &str) -> Result<()> {
        require!(
            !name.is_empty()
                && name.len() <= MAX_SCENARIO_NAME_BYTES
                && name.trim() == name
                && !name.chars().any(char::is_control),
            CcTokenError::InvalidScenarioName
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scenario_space_is_fixed() {
        assert_eq!(ScenarioDefinition::SPACE, 150);
    }

    #[test]
    fn scenario_names_are_bounded_by_utf8_bytes() {
        assert!(ScenarioDefinition::validate_name(&"a".repeat(64)).is_ok());
        assert!(ScenarioDefinition::validate_name(&"a".repeat(65)).is_err());
        assert!(ScenarioDefinition::validate_name(&"é".repeat(32)).is_ok());
        assert!(ScenarioDefinition::validate_name(&"é".repeat(33)).is_err());
    }

    #[test]
    fn scenario_names_reject_empty_padded_and_control_text() {
        for name in ["", " padded", "padded ", "line\nbreak", "nul\0byte"] {
            assert!(ScenarioDefinition::validate_name(name).is_err());
        }
        assert!(ScenarioDefinition::validate_name("SOL/USD at expiry").is_ok());
    }
}
