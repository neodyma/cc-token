use anchor_lang::prelude::*;

use crate::prelude::*;

pub const MAX_OUTCOME_COUNT: u16 = 256;
pub const MIN_OUTCOME_COUNT: u16 = 2;

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, Eq, InitSpace, PartialEq,
)]
pub struct IndexSet {
    pub words: [u64; 4],
}

impl IndexSet {
    pub const ZERO: Self = Self { words: [0; 4] };

    pub fn universe(outcome_count: u16) -> CcTokenResult<Self> {
        require!(
            (MIN_OUTCOME_COUNT..=MAX_OUTCOME_COUNT).contains(&outcome_count),
            CcTokenError::InvalidOutcomeCount
        );

        if outcome_count == MAX_OUTCOME_COUNT {
            return Ok(Self {
                words: [u64::MAX; 4],
            });
        }

        let mut words = [0; 4];
        let full_words = usize::from(outcome_count / 64);
        words[..full_words].fill(u64::MAX);
        let remaining_bits = outcome_count % 64;
        if remaining_bits != 0 {
            words[full_words] = (1u64 << remaining_bits) - 1;
        }
        Ok(Self { words })
    }

    pub fn from_be_bytes(bytes: [u8; 32]) -> Self {
        let mut words = [0; 4];
        for (index, word) in words.iter_mut().enumerate() {
            let start = (3 - index) * 8;
            *word = u64::from_be_bytes(bytes[start..start + 8].try_into().unwrap());
        }
        Self { words }
    }

    pub fn to_be_bytes(self) -> [u8; 32] {
        let mut bytes = [0; 32];
        for (index, word) in self.words.iter().enumerate() {
            let start = (3 - index) * 8;
            bytes[start..start + 8].copy_from_slice(&word.to_be_bytes());
        }
        bytes
    }

    pub fn is_empty(self) -> bool {
        self == Self::ZERO
    }

    pub fn contains(self, outcome: u16) -> bool {
        outcome < MAX_OUTCOME_COUNT
            && self.words[usize::from(outcome / 64)] & (1u64 << (outcome % 64)) != 0
    }

    pub fn union(self, other: Self) -> Self {
        Self {
            words: core::array::from_fn(|index| self.words[index] | other.words[index]),
        }
    }

    pub fn overlaps(self, other: Self) -> bool {
        self.words
            .iter()
            .zip(other.words)
            .any(|(left, right)| left & right != 0)
    }

    pub fn validate(self, outcome_count: u16) -> CcTokenResult {
        let full_index_set = Self::universe(outcome_count)?;
        require!(!self.is_empty(), CcTokenError::EmptyIndexSet);
        require!(
            self.words
                .iter()
                .zip(full_index_set.words)
                .all(|(word, full_word)| word & !full_word == 0),
            CcTokenError::IndexSetOutOfRange
        );
        require!(self != full_index_set, CcTokenError::FullIndexSet);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index_set(bits: &[u16]) -> IndexSet {
        let mut words = [0; 4];
        for bit in bits {
            words[usize::from(bit / 64)] |= 1 << (bit % 64);
        }
        IndexSet { words }
    }

    #[test]
    fn big_endian_conversion_preserves_word_and_bit_order() {
        let value = IndexSet {
            words: [
                0x0123_4567_89ab_cdef,
                0xfedc_ba98_7654_3210,
                0x1122_3344_5566_7788,
                0x8877_6655_4433_2211,
            ],
        };
        let bytes = value.to_be_bytes();

        assert_eq!(&bytes[..8], &0x8877_6655_4433_2211u64.to_be_bytes());
        assert_eq!(&bytes[24..], &0x0123_4567_89ab_cdefu64.to_be_bytes());
        assert_eq!(IndexSet::from_be_bytes(bytes), value);
    }

    #[test]
    fn validates_boundaries_through_outcome_255() {
        for (outcome_count, bits) in [
            (2, vec![0]),
            (3, vec![2]),
            (8, vec![7]),
            (16, vec![15]),
            (65, vec![63, 64]),
            (129, vec![127, 128]),
            (193, vec![191, 192]),
            (255, vec![254]),
            (256, vec![255]),
        ] {
            assert!(index_set(&bits).validate(outcome_count).is_ok());
        }
    }

    #[test]
    fn combines_and_queries_all_word_boundaries() {
        let left = index_set(&[0, 63, 127, 191, 255]);
        let right = index_set(&[64, 128, 192]);
        let union = left.union(right);

        for outcome in [0, 63, 64, 127, 128, 191, 192, 255] {
            assert!(union.contains(outcome));
        }
        assert!(!left.overlaps(right));
        assert!(left.overlaps(index_set(&[63])));
    }

    #[test]
    fn rejects_invalid_outcome_counts_and_subsets() {
        assert!(index_set(&[0]).validate(1).is_err());
        assert!(index_set(&[0]).validate(257).is_err());
        assert!(IndexSet::ZERO.validate(8).is_err());
        assert!(index_set(&[0, 1]).validate(2).is_err());
        assert!(index_set(&[8]).validate(8).is_err());
        assert!(IndexSet {
            words: [u64::MAX; 4]
        }
        .validate(256)
        .is_err());
    }
}
