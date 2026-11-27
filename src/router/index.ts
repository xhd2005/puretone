import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/home',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { tab: 'home', depth: 0, title: 'Home' },
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('@/views/LibraryView.vue'),
      meta: { tab: 'library', depth: 0, title: 'Library' },
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('@/views/SearchView.vue'),
      meta: { tab: 'search', depth: 0, title: 'Search' },
    },
    {
      path: '/playlist/:id',
      name: 'playlist',
      component: () => import('@/views/PlaylistDetailView.vue'),
      meta: { tab: 'library', depth: 1, title: 'Playlist' },
    },
    {
      path: '/daily',
      name: 'daily',
      component: () => import('@/views/DailyRecommendView.vue'),
      meta: { tab: 'home', depth: 1, title: 'Daily' },
    },
    {
      path: '/recent',
      name: 'recent',
      component: () => import('@/views/RecentPlaysView.vue'),
      meta: { tab: 'library', depth: 1, title: 'Recent' },
    },
  ],
});

export default router;
