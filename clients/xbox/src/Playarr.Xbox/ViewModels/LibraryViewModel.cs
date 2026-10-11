using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Xbox.ViewModels
{
    /// <summary>
    /// Backs <see cref="Views.LibraryPage"/>. Loads the server's catalog
    /// kinds via <see cref="IPlayarrApiClient.ListCatalogKindsAsync"/> on
    /// construction (rendered as filter tabs), then loads one page of
    /// <see cref="IPlayarrApiClient.BrowseCatalogAsync"/> results for the
    /// current kind/sort selection, reloading whenever either changes.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="SelectedSort"/>'s two values match
    /// <c>BrowseQueryParams::sort</c> on the server exactly
    /// (<c>backend/crates/playarr-api/src/catalog.rs</c>):
    /// <see cref="SortRecentlyAdded"/> (<c>"recent"</c>) for recently-added
    /// first, or <c>null</c> for the server's own default (title, ascending)
    /// -- there is no separate <c>"title"</c> wire value to send.
    /// </para>
    /// <para>
    /// Both <see cref="LoadKindsAndWorksAsync"/> and <see cref="LoadWorksAsync"/>
    /// deliberately omit <c>.ConfigureAwait(false)</c> -- see
    /// <see cref="ProfilesViewModel"/>'s remarks for why: the properties they
    /// set are read straight into XAML elements by
    /// <see cref="Views.LibraryPage"/>'s <c>Render()</c>, so their
    /// continuations must stay on the UI thread.
    /// </para>
    /// </remarks>
    public sealed class LibraryViewModel : ViewModelBase
    {
        /// <summary>Wire value for "recently added first". See this type's remarks.</summary>
        public const string SortRecentlyAdded = "recent";

        private const int PageLimit = 200;

        private readonly XboxAppEnvironment _environment;

        private IReadOnlyList<WorkKind> _kinds = Array.Empty<WorkKind>();
        private WorkKind? _selectedKind;
        private string? _selectedSort;
        private IReadOnlyList<Work> _works = Array.Empty<Work>();
        private long? _total;
        private bool _isLoadingKinds;
        private bool _isLoadingWorks;
        private string? _errorMessage;

        public LibraryViewModel(XboxAppEnvironment environment)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            _ = LoadKindsAndWorksAsync();
        }

        /// <summary>
        /// The kinds this server actually has, for the filter tabs. Never
        /// includes an "All" entry -- that's <c>null</c> <see cref="SelectedKind"/>,
        /// a page-level concept <see cref="Views.LibraryPage"/> adds itself.
        /// </summary>
        public IReadOnlyList<WorkKind> Kinds
        {
            get => _kinds;
            private set => SetProperty(ref _kinds, value);
        }

        /// <summary><c>null</c> means "All" (no kind filter).</summary>
        public WorkKind? SelectedKind
        {
            get => _selectedKind;
            private set => SetProperty(ref _selectedKind, value);
        }

        /// <summary><see cref="SortRecentlyAdded"/>, or <c>null</c> for title ascending. See this type's remarks.</summary>
        public string? SelectedSort
        {
            get => _selectedSort;
            private set => SetProperty(ref _selectedSort, value);
        }

        /// <summary>Server total for the current kind (the web header's "N TITLES"), when the server reports it.</summary>
        public long? Total
        {
            get => _total;
            private set => SetProperty(ref _total, value);
        }

        public IReadOnlyList<Work> Works
        {
            get => _works;
            private set => SetProperty(ref _works, value);
        }

        public bool IsLoadingKinds
        {
            get => _isLoadingKinds;
            private set => SetProperty(ref _isLoadingKinds, value);
        }

        public bool IsLoadingWorks
        {
            get => _isLoadingWorks;
            private set => SetProperty(ref _isLoadingWorks, value);
        }

        /// <summary>Set when either load fails; <c>null</c> otherwise.</summary>
        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        /// <summary>Wired to LibraryPage's kind tabs. <c>null</c> selects "All".</summary>
        public void SelectKind(WorkKind? kind)
        {
            if (SelectedKind == kind)
            {
                return;
            }

            SelectedKind = kind;
            _ = LoadWorksAsync();
        }

        /// <summary>Wired to LibraryPage's two sort buttons.</summary>
        public void SelectSort(string? sort)
        {
            if (SelectedSort == sort)
            {
                return;
            }

            SelectedSort = sort;
            _ = LoadWorksAsync();
        }

        /// <summary>Retries a failed load. Wired to LibraryPage's retry button.</summary>
        public void Retry() => _ = LoadWorksAsync();

        private async Task LoadKindsAndWorksAsync()
        {
            IsLoadingKinds = true;
            ErrorMessage = null;

            try
            {
                var kinds = await _environment.ApiClient.ListCatalogKindsAsync();
                Kinds = new List<WorkKind>(kinds);
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
                IsLoadingKinds = false;
            }

            await LoadWorksAsync();
        }

        private async Task LoadWorksAsync()
        {
            IsLoadingWorks = true;
            ErrorMessage = null;

            try
            {
                // Same first page as the web library: available titles only, title ascending (or newest first).
                var byTitle = SelectedSort == null;
                var page = await _environment.ApiClient.BrowseCatalogAsync(
                    kind: SelectedKind,
                    sort: byTitle ? "title" : "date_added",
                    limit: PageLimit,
                    availableOnly: true,
                    order: byTitle ? "asc" : "desc");
                Total = page.Total;
                var works = new List<Work>(page.Items);
                if (byTitle)
                {
                    works.Sort(WorkLabels.CompareTitles);
                }

                Works = works;
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
                IsLoadingWorks = false;
            }
        }
    }
}
