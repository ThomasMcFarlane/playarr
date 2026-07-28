using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace Playarr.Xbox
{
    /// <summary>
    /// Minimal <see cref="INotifyPropertyChanged"/> base shared by
    /// <see cref="XboxAppEnvironment"/> and every <c>ViewModels/*ViewModel</c>
    /// -- the one property-changed pattern every screen in this app uses.
    /// </summary>
    /// <remarks>
    /// Deliberately not a NuGet MVVM toolkit (CommunityToolkit.Mvvm, etc):
    /// this app is small enough that the ~15 lines below are the whole
    /// framework it needs, and it keeps Playarr.Xbox's dependency surface to
    /// exactly one package (<c>Microsoft.NETCore.UniversalWindowsPlatform</c>,
    /// see Playarr.Xbox.csproj) plus the in-repo Playarr.Core reference.
    /// </remarks>
    public abstract class ObservableObject : INotifyPropertyChanged
    {
        public event PropertyChangedEventHandler? PropertyChanged;

        /// <summary>
        /// Sets <paramref name="field"/> to <paramref name="value"/> and
        /// raises <see cref="PropertyChanged"/> for the calling property
        /// (via <see cref="CallerMemberNameAttribute"/>) when the value
        /// actually changed. Returns whether it changed, in case a caller
        /// wants to chain further work on an actual change only.
        /// </summary>
        protected bool SetProperty<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
        {
            if (EqualityComparer<T>.Default.Equals(field, value))
            {
                return false;
            }

            field = value;
            OnPropertyChanged(propertyName);
            return true;
        }

        protected void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
