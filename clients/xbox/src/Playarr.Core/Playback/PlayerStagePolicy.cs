namespace Playarr.Core.Playback
{
    /// <summary>What the BACK button does inside the player.</summary>
    public enum PlayerBackAction
    {
        /// <summary>Close the open track panel and return focus to the control that opened it.</summary>
        ClosePanel,

        /// <summary>Leave playback.</summary>
        Exit,
    }

    /// <summary>
    /// Pure rules for the player page: Play opens the player directly (black
    /// stage, title, at most a small spinner) while the session is negotiated.
    /// There is no interstitial page or full-screen message; only a failure
    /// replaces the stage, with its error panel.
    /// </summary>
    public static class PlayerStagePolicy
    {
        /// <summary>The video stage is shown for every state except a failure.</summary>
        public static bool StageVisible(bool isFailed) => !isFailed;

        /// <summary>The small buffering spinner overlays the stage while the stream is negotiated.</summary>
        public static bool SpinnerVisible(bool isLoading, bool isFailed) => isLoading && !isFailed;

        /// <summary>Panels close first, one level per press; only then does BACK exit.</summary>
        public static PlayerBackAction BackAction(bool panelOpen) =>
            panelOpen ? PlayerBackAction.ClosePanel : PlayerBackAction.Exit;
    }
}
