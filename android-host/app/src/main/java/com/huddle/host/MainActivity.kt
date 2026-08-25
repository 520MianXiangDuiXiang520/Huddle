package com.huddle.host

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.huddle.host.databinding.ActivityMainBinding
import com.huddle.host.server.HostRuntime
import com.huddle.host.ui.HomeFragment
import com.huddle.host.ui.MoreFragment

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (savedInstanceState == null) {
            showFragment(HomeFragment())
        }

        binding.bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> showFragment(HomeFragment())
                R.id.nav_more -> showFragment(MoreFragment())
                else -> return@setOnItemSelectedListener false
            }
            true
        }
    }

    override fun onResume() {
        super.onResume()
        if (HostRuntime.isRunning) {
            startActivity(android.content.Intent(this, RoomActivity::class.java))
        }
    }

    private fun showFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .commit()
    }
}
