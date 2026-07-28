using Playarr.Xbox;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Base class for every <c>ViewModels/*ViewModel</c>. Adds nothing
    /// beyond <see cref="ObservableObject"/> today; exists as the one place
    /// a genuinely common view-model concern (a shared busy flag, a shared
    /// error-message surface, etc) would go once a second screen needs one,
    /// so every other screen's view model picks it up for free instead of
    /// each page reinventing it.
    /// </summary>
    public abstract class ViewModelBase : ObservableObject
    {
    }
}
