using Playarr.Core.Playback;
using Xunit;

namespace Playarr.Core.Tests
{
    public class PlayerStagePolicyTests
    {
        [Fact]
        public void PlayMountsThePlayerStageWhileLoading()
        {
            Assert.True(PlayerStagePolicy.StageVisible(isFailed: false));
            Assert.True(PlayerStagePolicy.SpinnerVisible(isLoading: true, isFailed: false));
        }

        [Fact]
        public void OnlyAFailureReplacesTheStage()
        {
            Assert.False(PlayerStagePolicy.StageVisible(isFailed: true));
            Assert.False(PlayerStagePolicy.SpinnerVisible(isLoading: false, isFailed: true));
        }

        [Fact]
        public void BackClosesAnOpenPanelBeforeExiting()
        {
            Assert.Equal(PlayerBackAction.ClosePanel, PlayerStagePolicy.BackAction(panelOpen: true));
            Assert.Equal(PlayerBackAction.Exit, PlayerStagePolicy.BackAction(panelOpen: false));
        }
    }
}
