// Sample content inserted by the Seed_Script when SEED_SAMPLE_CONTENT=true and the Database holds
// no Projects, Skills, Experience_Records or Education_Records (Requirement 3.5).
//
// Every fixture is generic placeholder content with no real personal data, and satisfies the
// Validator rules for its type (projectBody, skillBody, experienceBody, educationBody). Field names
// match the request bodies, so task 5.10 can run each fixture through its schema unchanged.
// Replace or delete the samples from the Admin_Dashboard after seeding.

export const sampleProjects = Object.freeze([
  {
    title: 'Task Tracker API',
    slug: 'task-tracker-api',
    short_description: 'A REST API for creating, assigning and tracking tasks across small teams.',
    full_description:
      'Task Tracker API is a sample backend project. It exposes endpoints for projects, tasks and comments, with role-based access and paginated listings.',
    problem_statement: 'Small teams often track work in spreadsheets that drift out of date and offer no history.',
    objectives: 'Provide a simple, documented API with consistent responses and reliable validation.',
    challenges: 'Keeping list endpoints fast as the number of tasks grows.',
    solutions: 'Indexed listing queries, a single aggregated query per list and offset pagination.',
    category: 'Backend',
    image_url: '',
    github_url: 'https://github.com/example/task-tracker-api',
    live_demo_url: '',
    features: ['Create, update and archive tasks', 'Assign tasks to team members', 'Paginated task lists with filters'],
    technologies: ['Node.js', 'Express', 'PostgreSQL'],
    is_published: true,
    display_order: 0,
  },
  {
    title: 'Weather Dashboard',
    slug: 'weather-dashboard',
    short_description: 'A responsive single-page app that shows current conditions and a five-day forecast.',
    full_description:
      'Weather Dashboard is a sample frontend project. It lets visitors search for a city and see the current weather and a short forecast.',
    problem_statement: 'Many weather sites are cluttered with ads and slow on mobile connections.',
    objectives: 'Build a fast, accessible interface that works well on small screens.',
    challenges: 'Handling slow or failed network requests without confusing the user.',
    solutions: 'Clear loading and error states with a retry action, and cached recent searches.',
    category: 'Frontend',
    image_url: '',
    github_url: 'https://github.com/example/weather-dashboard',
    live_demo_url: 'https://example.com/weather-dashboard',
    features: ['City search with recent searches', 'Current conditions and five-day forecast', 'Keyboard accessible controls'],
    technologies: ['React', 'Vite', 'CSS'],
    is_published: true,
    display_order: 1,
  },
]);

export const sampleSkills = Object.freeze([
  { name: 'JavaScript', category: 'Programming Languages', proficiency_level: 'Advanced', icon_url: '', display_order: 0 },
  { name: 'SQL', category: 'Programming Languages', proficiency_level: 'Intermediate', icon_url: '', display_order: 1 },
  { name: 'React', category: 'Frontend Development', proficiency_level: 'Advanced', icon_url: '', display_order: 0 },
  { name: 'Node.js', category: 'Backend Development', proficiency_level: 'Advanced', icon_url: '', display_order: 0 },
  { name: 'PostgreSQL', category: 'Database', proficiency_level: 'Intermediate', icon_url: '', display_order: 0 },
  { name: 'Git', category: 'Development Tools', proficiency_level: 'Advanced', icon_url: '', display_order: 0 },
]);

export const sampleExperiences = Object.freeze([
  {
    job_title: 'Software Developer',
    company_name: 'Example Company',
    employment_type: 'Full-time',
    start_date: '2022-01-10',
    end_date: null,
    description: 'Builds and maintains web applications for internal and customer-facing teams.',
    responsibilities: [
      'Develop REST APIs and React interfaces',
      'Write automated tests and review pull requests',
      'Improve query performance and monitoring',
    ],
  },
]);

export const sampleEducation = Object.freeze([
  {
    institution: 'Example University',
    qualification: 'Bachelor of Science',
    field_of_study: 'Computer Science',
    start_year: 2017,
    end_year: 2021,
    description: 'Coursework in algorithms, databases, networks and software engineering.',
  },
]);

/** All sample content, grouped by type. */
export const sampleContent = Object.freeze({
  projects: sampleProjects,
  skills: sampleSkills,
  experiences: sampleExperiences,
  education: sampleEducation,
});

export default sampleContent;
