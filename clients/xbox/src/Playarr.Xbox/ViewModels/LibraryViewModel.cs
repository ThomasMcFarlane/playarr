using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Xbox.ViewModels
{
    public enum LibraryViewMode
    {
        Catalog,
        Folders,
    }

    /// <summary>
    /// Backs the native library screen. Alongside the catalogue grid it owns
    /// the path-safe Folders view: source root discovery, breadcrumb
    /// navigation, one-directory paging, and file-derived media entries.
    /// </summary>
    /// <remarks>
    /// All async continuations intentionally remain on the UI context. The
    /// page subscribes to these properties and pushes them into named XAML
    /// controls from one <c>Render()</c> method.
    /// </remarks>
    public sealed class LibraryViewModel : ViewModelBase
    {
        public const string SortRecentlyAdded = "recent";

        private const int CatalogPageLimit = 60;
        private const int FolderPageLimit = 100;

        private readonly XboxAppEnvironment _environment;

        private IReadOnlyList<WorkKind> _kinds = Array.Empty<WorkKind>();
        private WorkKind? _selectedKind;
        private string? _selectedSort;
        private LibraryViewMode _viewMode;
        private IReadOnlyList<Work> _works = Array.Empty<Work>();
        private IReadOnlyList<FolderRoot> _folderRoots = Array.Empty<FolderRoot>();
        private IReadOnlyList<FolderRootError> _folderRootErrors = Array.Empty<FolderRootError>();
        private FolderRoot? _selectedFolderRoot;
        private FolderBrowseResponse? _folderDirectory;
        private IReadOnlyList<FolderEntry> _folderEntries = Array.Empty<FolderEntry>();
        private bool _isLoadingKinds;
        private bool _isLoadingWorks;
        private bool _isLoadingFolderRoots;
        private bool _isLoadingFolderDirectory;
        private bool _isLoadingMoreFolders;
        private string? _errorMessage;
        private string _folderPath = string.Empty;
        private int _folderRootGeneration;
        private int _folderBrowseGeneration;

        public LibraryViewModel(
            XboxAppEnvironment environment,
            LibraryFolderNavigationState? restoredFolderState = null)
        {
            _environment = environment ?? throw new ArgumentNullException(nameof(environment));
            if (restoredFolderState != null)
            {
                _selectedKind = restoredFolderState.LibraryKind;
                _viewMode = LibraryViewMode.Folders;
                _folderPath = restoredFolderState.Path;
            }

            _ = LoadKindsAndContentAsync(restoredFolderState);
        }

        public IReadOnlyList<WorkKind> Kinds
        {
            get => _kinds;
            private set => SetProperty(ref _kinds, value);
        }

        /// <summary><c>null</c> means the catalogue's combined "All" view.</summary>
        public WorkKind? SelectedKind
        {
            get => _selectedKind;
            private set => SetProperty(ref _selectedKind, value);
        }

        public string? SelectedSort
        {
            get => _selectedSort;
            private set => SetProperty(ref _selectedSort, value);
        }

        public LibraryViewMode ViewMode
        {
            get => _viewMode;
            private set => SetProperty(ref _viewMode, value);
        }

        public IReadOnlyList<Work> Works
        {
            get => _works;
            private set => SetProperty(ref _works, value);
        }

        public IReadOnlyList<FolderRoot> FolderRoots
        {
            get => _folderRoots;
            private set => SetProperty(ref _folderRoots, value);
        }

        public IReadOnlyList<FolderRootError> FolderRootErrors
        {
            get => _folderRootErrors;
            private set => SetProperty(ref _folderRootErrors, value);
        }

        public FolderRoot? SelectedFolderRoot
        {
            get => _selectedFolderRoot;
            private set => SetProperty(ref _selectedFolderRoot, value);
        }

        public FolderBrowseResponse? FolderDirectory
        {
            get => _folderDirectory;
            private set => SetProperty(ref _folderDirectory, value);
        }

        public IReadOnlyList<FolderEntry> FolderEntries
        {
            get => _folderEntries;
            private set => SetProperty(ref _folderEntries, value);
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

        public bool IsLoadingFolderRoots
        {
            get => _isLoadingFolderRoots;
            private set => SetProperty(ref _isLoadingFolderRoots, value);
        }

        public bool IsLoadingFolderDirectory
        {
            get => _isLoadingFolderDirectory;
            private set => SetProperty(ref _isLoadingFolderDirectory, value);
        }

        public bool IsLoadingMoreFolders
        {
            get => _isLoadingMoreFolders;
            private set => SetProperty(ref _isLoadingMoreFolders, value);
        }

        public bool SupportsFolders =>
            SelectedKind == WorkKind.Movie ||
            SelectedKind == WorkKind.Series ||
            SelectedKind == WorkKind.Site ||
            SelectedKind == WorkKind.Artist;

        public bool HasMoreFolderEntries =>
            FolderDirectory != null && FolderEntries.Count < FolderDirectory.Total;

        public string? ErrorMessage
        {
            get => _errorMessage;
            private set => SetProperty(ref _errorMessage, value);
        }

        /// <summary>
        /// Captures only opaque/root-relative navigation state. The returned
        /// object is safe to retain while the native player is on screen and
        /// contains no source filesystem path.
        /// </summary>
        public LibraryFolderNavigationState? CaptureFolderNavigationState()
        {
            if (ViewMode != LibraryViewMode.Folders ||
                SelectedKind == null ||
                SelectedFolderRoot == null)
            {
                return null;
            }

            return new LibraryFolderNavigationState(
                SelectedKind.Value,
                SelectedFolderRoot.Id,
                _folderPath,
                FolderEntries.Count);
        }

        public void SelectKind(WorkKind? kind)
        {
            if (SelectedKind == kind)
            {
                return;
            }

            SelectedKind = kind;
            OnPropertyChanged(nameof(SupportsFolders));

            if (ViewMode == LibraryViewMode.Folders && !SupportsFolders)
            {
                ViewMode = LibraryViewMode.Catalog;
                InvalidateFolderLoads();
            }

            if (ViewMode == LibraryViewMode.Folders)
            {
                _ = LoadFolderRootsAsync();
            }
            else
            {
                _ = LoadWorksAsync();
            }
        }

        public void SelectSort(string? sort)
        {
            if (SelectedSort == sort)
            {
                return;
            }

            SelectedSort = sort;
            if (ViewMode == LibraryViewMode.Catalog)
            {
                _ = LoadWorksAsync();
            }
        }

        public void SelectViewMode(LibraryViewMode mode)
        {
            if (mode == LibraryViewMode.Folders && !SupportsFolders)
            {
                return;
            }

            if (ViewMode == mode)
            {
                return;
            }

            ViewMode = mode;
            ErrorMessage = null;

            if (mode == LibraryViewMode.Folders)
            {
                _ = LoadFolderRootsAsync();
            }
            else
            {
                InvalidateFolderLoads();
                _ = LoadWorksAsync();
            }
        }

        public void SelectFolderRoot(FolderRoot root)
        {
            if (!root.Available || ViewMode != LibraryViewMode.Folders)
            {
                return;
            }

            SelectedFolderRoot = root;
            _ = BrowseFolderAsync(string.Empty, append: false);
        }

        public void BrowseFolder(string path)
        {
            if (SelectedFolderRoot != null && ViewMode == LibraryViewMode.Folders)
            {
                _ = BrowseFolderAsync(path, append: false);
            }
        }

        public void LoadMoreFolderEntries()
        {
            if (!IsLoadingMoreFolders && HasMoreFolderEntries)
            {
                _ = BrowseFolderAsync(_folderPath, append: true);
            }
        }

        public void Retry()
        {
            if (ViewMode == LibraryViewMode.Catalog)
            {
                _ = LoadWorksAsync();
            }
            else if (SelectedFolderRoot == null)
            {
                _ = LoadFolderRootsAsync();
            }
            else
            {
                _ = BrowseFolderAsync(_folderPath, append: false);
            }
        }

        private async Task LoadKindsAndContentAsync(
            LibraryFolderNavigationState? restoredFolderState)
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

            if (restoredFolderState != null && SupportsFolders)
            {
                await LoadFolderRootsAsync(restoredFolderState);
            }
            else
            {
                if (ViewMode == LibraryViewMode.Folders)
                {
                    ViewMode = LibraryViewMode.Catalog;
                }

                await LoadWorksAsync();
            }
        }

        private async Task LoadWorksAsync()
        {
            IsLoadingWorks = true;
            ErrorMessage = null;

            try
            {
                var page = await _environment.ApiClient.BrowseCatalogAsync(
                    kind: SelectedKind,
                    sort: SelectedSort,
                    limit: CatalogPageLimit);
                Works = new List<Work>(page.Items);
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

        private async Task LoadFolderRootsAsync(
            LibraryFolderNavigationState? restoredFolderState = null)
        {
            if (!SupportsFolders || SelectedKind == null)
            {
                return;
            }

            var generation = ++_folderRootGeneration;
            _folderBrowseGeneration++;
            IsLoadingFolderRoots = true;
            IsLoadingFolderDirectory = false;
            IsLoadingMoreFolders = false;
            ErrorMessage = null;
            FolderRoots = Array.Empty<FolderRoot>();
            FolderRootErrors = Array.Empty<FolderRootError>();
            SelectedFolderRoot = null;
            FolderDirectory = null;
            FolderEntries = Array.Empty<FolderEntry>();
            _folderPath = string.Empty;
            OnPropertyChanged(nameof(HasMoreFolderEntries));

            try
            {
                var response = await _environment.ApiClient.ListFolderRootsAsync(SelectedKind.Value);
                if (generation != _folderRootGeneration || ViewMode != LibraryViewMode.Folders)
                {
                    return;
                }

                FolderRoots = new List<FolderRoot>(response.Roots);
                FolderRootErrors = new List<FolderRootError>(response.Errors);

                FolderRoot? selectedRoot = null;
                if (restoredFolderState != null)
                {
                    foreach (var root in FolderRoots)
                    {
                        if (root.Available && root.Id == restoredFolderState.RootFolderId)
                        {
                            selectedRoot = root;
                            break;
                        }
                    }
                }

                if (selectedRoot == null)
                {
                    foreach (var root in FolderRoots)
                    {
                        if (root.Available)
                        {
                            selectedRoot = root;
                            break;
                        }
                    }
                }

                if (selectedRoot != null)
                {
                    SelectedFolderRoot = selectedRoot;
                    var restoresSameRoot =
                        restoredFolderState != null &&
                        selectedRoot.Id == restoredFolderState.RootFolderId;
                    await RestoreFolderAsync(
                        selectedRoot.Id,
                        restoresSameRoot ? restoredFolderState!.Path : string.Empty,
                        restoresSameRoot ? restoredFolderState!.LoadedEntryCount : 0);
                }
            }
            catch (ApiException error)
            {
                if (generation == _folderRootGeneration)
                {
                    ErrorMessage = error.DisplayMessage;
                }
            }
            catch (Exception error)
            {
                if (generation == _folderRootGeneration)
                {
                    ErrorMessage = error.Message;
                }
            }
            finally
            {
                if (generation == _folderRootGeneration)
                {
                    IsLoadingFolderRoots = false;
                }
            }
        }

        private async Task RestoreFolderAsync(Guid rootFolderId, string path, int loadedEntryCount)
        {
            await BrowseFolderAsync(path, append: false);

            while (FolderEntries.Count < loadedEntryCount &&
                HasMoreFolderEntries &&
                SelectedFolderRoot?.Id == rootFolderId &&
                string.Equals(_folderPath, path, StringComparison.Ordinal) &&
                ViewMode == LibraryViewMode.Folders &&
                string.IsNullOrEmpty(ErrorMessage))
            {
                var previousCount = FolderEntries.Count;
                await BrowseFolderAsync(_folderPath, append: true);
                if (FolderEntries.Count <= previousCount)
                {
                    break;
                }
            }
        }

        private async Task BrowseFolderAsync(string path, bool append)
        {
            var root = SelectedFolderRoot;
            if (root == null)
            {
                return;
            }

            var generation = ++_folderBrowseGeneration;
            var offset = append ? FolderEntries.Count : 0;

            if (append)
            {
                IsLoadingMoreFolders = true;
            }
            else
            {
                _folderPath = path;
                IsLoadingFolderDirectory = true;
                FolderDirectory = null;
                FolderEntries = Array.Empty<FolderEntry>();
                OnPropertyChanged(nameof(HasMoreFolderEntries));
            }

            ErrorMessage = null;

            try
            {
                var response = await _environment.ApiClient.BrowseFolderAsync(
                    root.Id,
                    path,
                    FolderPageLimit,
                    offset);

                if (generation != _folderBrowseGeneration ||
                    SelectedFolderRoot?.Id != root.Id ||
                    ViewMode != LibraryViewMode.Folders)
                {
                    return;
                }

                if (append)
                {
                    var combined = new List<FolderEntry>(FolderEntries);
                    combined.AddRange(response.Entries);
                    FolderEntries = combined;
                }
                else
                {
                    FolderEntries = new List<FolderEntry>(response.Entries);
                }

                FolderDirectory = response;
                _folderPath = response.Path;
                OnPropertyChanged(nameof(HasMoreFolderEntries));
            }
            catch (ApiException error)
            {
                if (generation == _folderBrowseGeneration)
                {
                    ErrorMessage = error.DisplayMessage;
                }
            }
            catch (Exception error)
            {
                if (generation == _folderBrowseGeneration)
                {
                    ErrorMessage = error.Message;
                }
            }
            finally
            {
                if (generation == _folderBrowseGeneration)
                {
                    IsLoadingFolderDirectory = false;
                    IsLoadingMoreFolders = false;
                }
            }
        }

        private void InvalidateFolderLoads()
        {
            _folderRootGeneration++;
            _folderBrowseGeneration++;
            IsLoadingFolderRoots = false;
            IsLoadingFolderDirectory = false;
            IsLoadingMoreFolders = false;
        }
    }
}
