using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Backs <see cref="Views.HomePage"/>. Loads the most recently added
    /// works via <see cref="IPlayarrApiClient.BrowseCatalogAsync"/>
    /// (<c>sort: "recent"</c>) on construction.
    /// </summary>
    /// <remarks>
    /// Follows the same load-on-construct, fire-and-forget shape as
    /// <see cref="ProfilesViewModel"/> -- see that type's remarks for why
    /// tile selection itself needs no ViewModel-observed state:
    /// <see cref="Views.HomePage"/> navigates to <see cref="Views.WorkDetailPage"/>
    /// directly from its tile <c>ItemClick</c> handler, and
    /// <see cref="LoadAsync"/> likewise omits <c>.ConfigureAwait(false)</c>
    /// so its continuation stays on the UI thread that <c>Render()</c>
    /// needs.
    /// </remarks>
    public sealed class HomeViewModel : ViewModelBase
    {
        private const string RecentSort = "recent";
        private const int RecentLimit = 30;

        private readonly XboxAppEnvironment _environment;

        private IReadOnlyList<Work> _recentWorks = Array.Empty<Work>();
        private bool _isLoading;
        private string? _errorMessage;

        public HomeViewModel(XboxAppEnvironment environment)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            _ = LoadAsync();
        }

        public IReadOnlyList<Work> RecentWorks
        {
            get => _recentWorks;
            private set => SetProperty(ref _recentWorks, value);
        }

        public bool IsLoading
        {
            get => _isLoading;
            private set => SetProperty(ref _isLoading, value);
        }

        /// <summary>Set when <see cref="LoadAsync"/> fails; <c>null</c> otherwise.</summary>
        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        /// <summary>Retries a failed load. Wired to HomePage's retry button.</summary>
        public void Retry() => _ = LoadAsync();

        private async Task LoadAsync()
        {
            IsLoading = true;
            ErrorMessage = null;

            try
            {
                var page = await _environment.ApiClient.BrowseCatalogAsync(sort: RecentSort, limit: RecentLimit);
                RecentWorks = new List<Work>(page.Items);
            }
            catch (ApiException error)
            {
                ErrorMessage = error.DisplayMessage;
            }
            catch (Exception error)
            {
                ErrorMessage = error.Message;
            }
            finally
            {
                IsLoading = false;
            }
        }
    }
}
